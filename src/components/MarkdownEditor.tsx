/**
 * MarkdownEditor — a controlled monospace <textarea> for the resume source,
 * with editor quality-of-life features (#61).
 *
 * It stays a real <textarea> underneath — no contenteditable, no editor
 * library, no new dependencies. The added chrome is layered around it:
 *
 *  - Line-number gutter: a scroll-synced, `aria-hidden` column of line
 *    numbers rendered beside the textarea.
 *  - Soft-wrap toggle: switches the textarea's `wrap` attribute (and the
 *    matching `white-space`) between wrapped and off; remembered for the
 *    session via sessionStorage.
 *  - Section snippets: an "insert section" menu offering a few resume
 *    section skeletons inserted at the caret.
 *
 * Every keystroke is still emitted up to ResumeStudio, which debounces
 * re-parsing. The editor holds no parsing logic.
 */
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Ref } from 'react';
import Icon from './Icon';
import {
  getRewriteCandidates,
  isUnderExperienceHeading,
  type RewriteCandidate,
} from '../utils/bulletPatterns';

/**
 * Imperative handle exposed via the `editorRef` prop. ResumeStudio uses this
 * to drive the textarea from outside the component when the Resume Health
 * panel asks to "Jump to line N" — see `onJumpToLine` in ResumeStudio.tsx.
 *
 * Kept narrow on purpose: the only outside-the-component need is to highlight
 * a specific line, so we expose just enough to do that without leaking the
 * textarea DOM node.
 */
export interface MarkdownEditorHandle {
  /** Scroll to a 1-based line and select that line (visual highlight). */
  jumpToLine(line: number): void;
  /**
   * Scroll to a 1-based line and select the FIRST occurrence of `offender`
   * on that line. Falls back to selecting the whole line when the offender
   * is not present (defensive — covers the case where the user has edited
   * the line since the finding was computed).
   */
  jumpToOffender(line: number, offender: string): void;
  /**
   * Insert a new bullet line above `targetLine` (1-based). Used by Health's
   * "Suggest a fix" tray to apply a candidate rewrite without disturbing
   * the original bullet — same pattern as the in-editor rewrite tray (#93).
   */
  insertRewriteAboveLine(targetLine: number, rewrittenLine: string): void;
  /**
   * Scroll to the first H2 heading whose title (case-insensitively) matches
   * `sectionTitle` and select the heading line. Used by Health's "Open an
   * example" affordance when no templated fix exists. No-op when the
   * section isn't present in the source.
   */
  jumpToSection(sectionTitle: string): void;
}

interface MarkdownEditorProps {
  /** Current Markdown source string (controlled). */
  value: string;
  /** Called with the new value on every edit. */
  onChange: (value: string) => void;
  /** Imperative-handle ref. Optional — most callers don't need it. */
  editorRef?: Ref<MarkdownEditorHandle>;
  /**
   * Called whenever the caret moves (selection change, click, keyup,
   * arrow-key, programmatic jump). Both values are 1-based; `null` means
   * the textarea has no caret yet (the user has not focused it this
   * session, or it just blurred). Powers the status-line cursor segment
   * (#134). The component still owns its internal `caret` state for the
   * bullet-rewrite affordance; this callback is a strict observer.
   */
  onCaretChange?: (line: number | null, column: number | null) => void;
}

/** Session-scoped key for the soft-wrap preference. */
const WRAP_KEY = 'womr:editor-soft-wrap';

/** Safely obtain `sessionStorage`, or `null` when unavailable (SSR / blocked). */
function safeSessionStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** Read the persisted soft-wrap preference. Defaults to `true` (wrapped). */
function getStoredSoftWrap(): boolean {
  const store = safeSessionStorage();
  if (!store) return true;
  try {
    return store.getItem(WRAP_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Persist the soft-wrap preference for the session. Best-effort. */
function setStoredSoftWrap(wrap: boolean): void {
  const store = safeSessionStorage();
  if (!store) return;
  try {
    store.setItem(WRAP_KEY, wrap ? '1' : '0');
  } catch {
    /* no-op: persistence is best-effort only */
  }
}

/** A resume section skeleton offered by the section-snippet controls. */
interface Snippet {
  /** Stable id (used as the React key and menu item identity). */
  id: string;
  /** Label used inside the popover menu. */
  label: string;
  /** Shorter label used on the always-visible toolbar button (#70). */
  quickLabel?: string;
  /** Markdown inserted at the caret. */
  body: string;
}

const SNIPPETS: Snippet[] = [
  {
    id: 'frontmatter',
    label: 'Frontmatter (identity header)',
    body: `---
name: Your Name
role: Your Role
location: City, State
email: you@example.com
links:
  - label: GitHub
    url: https://github.com/your-handle
  - label: LinkedIn
    url: https://www.linkedin.com/in/your-handle
---

`,
  },
  {
    id: 'experience',
    label: 'Experience entry',
    quickLabel: 'Experience',
    body: `### Job Title — Company Name
*City, ST · Mon YYYY – Present*

- Achievement or responsibility, with a measurable result.
- Another bullet describing impact.
`,
  },
  {
    id: 'education',
    label: 'Education entry',
    quickLabel: 'Education',
    body: `### Degree, Field of Study
*School Name · City, ST · YYYY*

- Honors, relevant coursework, or activities.
`,
  },
  {
    id: 'skills',
    label: 'Skills section',
    body: `## Skills

**Languages:** Skill, Skill, Skill
**Tools:** Skill, Skill, Skill
**Other:** Skill, Skill
`,
  },
  {
    id: 'summary',
    label: 'Summary section',
    body: `## Summary

One or two sentences describing who you are and what you do.
`,
  },
  {
    id: 'project',
    label: 'Project entry',
    body: `### Project Name
*Role · YYYY · [link](https://example.com)*

- What it does and the problem it solves.
- Notable result, scale, or technology.
`,
  },
];

/* The two snippets an empty resume most needs are promoted to always-visible
   toolbar buttons (#70 — alt UX proposed by @theshantanujoshi in PR #65).
   The remaining three stay in the popover. On narrow viewports the
   always-visible row collapses via CSS @media; the popover continues to
   list all five so nothing is unreachable. */
const QUICK_SNIPPETS: Snippet[] = SNIPPETS.filter((s) => s.quickLabel !== undefined);

export default function MarkdownEditor({
  value,
  onChange,
  editorRef,
  onCaretChange,
}: MarkdownEditorProps) {
  const textareaId = useId();
  const snippetMenuId = useId();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const snippetWrapRef = useRef<HTMLDivElement>(null);
  const snippetTriggerRef = useRef<HTMLButtonElement>(null);

  /* Soft-wrap is read in an effect (not lazy init) so the server and first
     client render agree — storage is client-only. Default: wrapped. */
  const [softWrap, setSoftWrap] = useState(true);
  const [snippetOpen, setSnippetOpen] = useState(false);

  /* Caret position used to derive bullet-rewrite eligibility (#93). We
     store the selectionStart; selectionEnd is implied by the caret being
     on the line containing this offset. Updated on every selection-change
     event the textarea fires (keyboard, click, drag). `null` means the
     textarea has never been interacted with this session — the affordance
     stays hidden until the user actually places the caret. */
  const [caret, setCaret] = useState<number | null>(null);
  const [rewriteTrayOpen, setRewriteTrayOpen] = useState(false);
  const rewriteWrapRef = useRef<HTMLDivElement>(null);
  const rewriteTriggerRef = useRef<HTMLButtonElement>(null);
  const rewriteTrayId = useId();

  useEffect(() => {
    setSoftWrap(getStoredSoftWrap());
  }, []);

  const lineCount = value.length === 0 ? 0 : value.split('\n').length;
  const charCount = value.length;

  /* The gutter renders one number per line; at minimum one row so the gutter
     never collapses to nothing for an empty document. */
  const gutterRows = useMemo(() => {
    const rows = Math.max(lineCount, 1);
    return Array.from({ length: rows }, (_, i) => i + 1);
  }, [lineCount]);

  /* ----- Structural overlay rows (#141) -----
     The overlay paints two subtle structural cues behind the textarea:
       - a 2 px accent left-rail on heading lines (first non-whitespace `#`)
       - a 1 px-tinted background band over the leading frontmatter block
         (the region between an opening `---` on line 0 and the next `---`)

     We emit one `<div>` per source line; class selection happens here so
     the JSX stays declarative. Memoized on `value` so an unchanged source
     skips the array allocation on caret-only re-renders. Frontmatter
     detection is deliberately strict: the opening `---` must sit on line
     0 (consistent with how the upstream parser keys identity off the
     leading block). The closing fence is the first `---` line after it;
     when the writer hasn't typed it yet the band extends to end-of-doc,
     which is fine — the band is the visual hint that "you're inside a
     frontmatter block right now". */
  interface OverlayRow {
    /** 0-based line index — used as the React key. */
    index: number;
    /** Raw line text. For empty lines we substitute a non-breaking
        space character so the row keeps its line-height contribution
        to vertical metrics (an empty `<div>` with `white-space: pre-wrap`
        does NOT reliably measure to one line height; an explicit char
        side-steps that and keeps the per-line vertical register matching
        the textarea exactly). */
    text: string;
    /** Line begins with `#` after stripping leading whitespace. */
    isHeading: boolean;
    /** Line is inside (or is a fence of) the leading frontmatter block. */
    isFrontmatter: boolean;
  }
  const overlayRows = useMemo<OverlayRow[]>(() => {
    const lines = value.split('\n');
    // Locate the closing frontmatter fence, if any. The opener must be at
    // line 0 (strict match — bare `---`, optional trailing whitespace).
    const hasOpenerAt0 = lines.length > 0 && /^---\s*$/.test(lines[0]);
    let closeIndex = -1;
    if (hasOpenerAt0) {
      for (let i = 1; i < lines.length; i++) {
        if (/^---\s*$/.test(lines[i])) {
          closeIndex = i;
          break;
        }
      }
    }
    // The frontmatter band spans line 0 through closeIndex (inclusive)
    // when both fences are present. With only the opener typed so far,
    // we extend the band to end-of-document so the writer sees the band
    // grow with their input — disappearing the moment they type the close.
    const frontmatterEnd = hasOpenerAt0 ? (closeIndex >= 0 ? closeIndex : lines.length - 1) : -1;
    return lines.map((text, index) => {
      const stripped = text.replace(/^\s+/, '');
      return {
        index,
        text,
        isHeading: stripped.length > 0 && stripped.charCodeAt(0) === 35 /* '#' */,
        isFrontmatter: hasOpenerAt0 && index <= frontmatterEnd,
      };
    });
  }, [value]);

  /* ----- Bullet-rewrite eligibility (#93) -----
     When the caret sits on a Markdown bullet inside an Experience-style
     H2, we surface a small "Rewrite this bullet" affordance that opens
     a tray of 2-3 pattern-based candidates. Eligibility is recomputed
     on every caret move, and the affordance is hidden whenever the
     caret leaves the bullet (including when the user types past the
     end of the line and converts it into prose). */
  const rewriteContext = useMemo(() => {
    if (caret === null) return null;
    // Slice the document into lines and find which one contains the caret.
    // We track each line's [start, end) offsets so that an "insert above"
    // can target the line start without re-walking the document.
    const lines = value.split('\n');
    let offset = 0;
    let lineIndex = -1;
    let lineStart = 0;
    for (let i = 0; i < lines.length; i++) {
      const lineEnd = offset + lines[i].length;
      if (caret >= offset && caret <= lineEnd) {
        lineIndex = i;
        lineStart = offset;
        break;
      }
      offset = lineEnd + 1; // +1 for the consumed '\n'
    }
    if (lineIndex < 0) return null;
    const line = lines[lineIndex];
    if (!isUnderExperienceHeading(lines, lineIndex)) return null;
    const candidates = getRewriteCandidates(line);
    if (candidates.length === 0) return null;
    return { lineIndex, lineStart, candidates };
  }, [value, caret]);

  /* Hide the tray and reset trigger focus whenever the caret moves off an
     eligible bullet. Keeps the affordance affordance from lingering in a
     stale state after the user types into the bullet text. */
  useEffect(() => {
    if (rewriteContext === null && rewriteTrayOpen) {
      setRewriteTrayOpen(false);
    }
  }, [rewriteContext, rewriteTrayOpen]);

  /* ----- Caret → (line, column) observer (#134) -----
     The status line wants the current 1-based cursor position. We already
     track `caret` (the selectionStart offset) for the bullet-rewrite
     affordance, so the cheapest place to emit line/column is right here:
     when either `caret` or `value` changes, re-derive the position and
     hand it up. Pure function of the latest two inputs — no separate
     storage layer. */
  useEffect(() => {
    if (!onCaretChange) return;
    if (caret === null) {
      onCaretChange(null, null);
      return;
    }
    // Clamp into the live document; an externally-driven value change
    // (snapshot load, clear) can leave the previous `caret` pointing past
    // the new end-of-document for a tick.
    const safe = Math.max(0, Math.min(caret, value.length));
    const upto = value.slice(0, safe);
    const newlineIndex = upto.lastIndexOf('\n');
    const line = upto.length === 0 ? 1 : upto.split('\n').length;
    const column = newlineIndex === -1 ? safe + 1 : safe - newlineIndex;
    onCaretChange(line, column);
  }, [caret, value, onCaretChange]);

  /* Close the rewrite tray on an outside pointer-down. Mirrors the
     section-snippet popover's pattern. */
  useEffect(() => {
    if (!rewriteTrayOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!rewriteWrapRef.current?.contains(event.target as Node)) {
        setRewriteTrayOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [rewriteTrayOpen]);

  /**
   * Apply a rewrite candidate: insert its `rewrittenLine` as a new bullet
   * line directly ABOVE the original. Never destructive — the original
   * bullet stays untouched so the writer can pick the one they prefer
   * and delete the rest.
   *
   * The same `value` / `onChange` pipe the snippet inserter uses is
   * reused here so the debounced parser upstairs sees a single, ordinary
   * value update. After insertion we restore the caret to the original
   * bullet (now offset by the inserted line's length + newline) so the
   * writer can keep editing without losing their place.
   */
  const applyRewrite = useCallback(
    (candidate: RewriteCandidate) => {
      if (rewriteContext === null) return;
      const { lineStart } = rewriteContext;
      const inserted = `${candidate.rewrittenLine}\n`;
      const next = value.slice(0, lineStart) + inserted + value.slice(lineStart);
      onChange(next);
      setRewriteTrayOpen(false);

      // Restore focus and put the caret back where it was on the original
      // bullet (now shifted down by the inserted line's character count).
      const newCaret = (caret ?? lineStart) + inserted.length;
      window.setTimeout(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(newCaret, newCaret);
          setCaret(newCaret);
        }
      }, 0);
    },
    [rewriteContext, value, onChange, caret],
  );

  /** Close the rewrite tray and restore focus to its trigger button. */
  const closeRewriteTray = useCallback(() => {
    setRewriteTrayOpen(false);
    rewriteTriggerRef.current?.focus();
  }, []);

  /** Toggle soft-wrap and persist it for the session. */
  const toggleSoftWrap = useCallback(() => {
    setSoftWrap((prev) => {
      const next = !prev;
      setStoredSoftWrap(next);
      return next;
    });
  }, []);

  /* Keep the gutter's and the structural overlay's vertical scroll locked
     to the textarea's. The overlay (#141) sits behind the textarea and
     mirrors line layout; out-of-sync scroll would smear the heading rail
     across the wrong lines, so the same callback drives both. */
  const syncScroll = useCallback(() => {
    const gutter = gutterRef.current;
    const overlay = overlayRef.current;
    const textarea = textareaRef.current;
    if (textarea) {
      if (gutter) gutter.scrollTop = textarea.scrollTop;
      if (overlay) {
        overlay.scrollTop = textarea.scrollTop;
        overlay.scrollLeft = textarea.scrollLeft;
      }
    }
  }, []);

  /* When the value changes externally (upload, clear, snippet insert), the
     line count — and thus gutter height — can change; re-sync afterwards. */
  useEffect(() => {
    syncScroll();
  }, [value, softWrap, syncScroll]);

  /* Close the snippet menu on an outside pointer-down. */
  useEffect(() => {
    if (!snippetOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!snippetWrapRef.current?.contains(event.target as Node)) {
        setSnippetOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [snippetOpen]);

  /** Close the snippet menu and return focus to its trigger. */
  const closeSnippetMenu = useCallback(() => {
    setSnippetOpen(false);
    snippetTriggerRef.current?.focus();
  }, []);

  /**
   * Insert a snippet at the caret (replacing any selection). The snippet is
   * padded with surrounding blank lines so it never fuses onto adjacent
   * content. Caret is left after the inserted text and the textarea refocused.
   *
   * Auto-prepend frontmatter (#97): when the editor is empty AND the picked
   * snippet is not the frontmatter itself, prepend the frontmatter identity
   * header so a fresh document starts with valid identity. The detection is
   * deliberately strict — if any `---\n` already opens the document (even a
   * partial / hand-edited block) we leave it alone.
   */
  const insertSnippet = useCallback(
    (snippet: Snippet) => {
      const textarea = textareaRef.current;
      const start = textarea ? textarea.selectionStart : value.length;
      const end = textarea ? textarea.selectionEnd : value.length;

      const before = value.slice(0, start);
      const after = value.slice(end);

      // Ensure a blank line separates the snippet from preceding content.
      let lead = '';
      if (before.length > 0 && !before.endsWith('\n\n')) {
        lead = before.endsWith('\n') ? '\n' : '\n\n';
      }
      // And a trailing blank line before any following content.
      let trail = '';
      if (after.length > 0 && !after.startsWith('\n')) {
        trail = '\n';
      }

      // Auto-prepend frontmatter on an empty document when the user picks any
      // other snippet (#97). With value === '' the caret is at 0, before/after
      // are both empty, lead/trail collapse to '', so the result is simply
      // `<frontmatter><snippet>` — exactly what we want.
      const shouldPrependFrontmatter =
        snippet.id !== 'frontmatter' && value.length === 0 && !/^---\s*\n/.test(value);
      const frontmatterPrefix = shouldPrependFrontmatter
        ? (SNIPPETS.find((s) => s.id === 'frontmatter')?.body ?? '')
        : '';

      const inserted = `${frontmatterPrefix}${lead}${snippet.body}${trail}`;
      const next = before + inserted + after;
      onChange(next);

      setSnippetOpen(false);

      // Restore focus and place the caret just after the inserted snippet.
      const caret = start + inserted.length;
      window.setTimeout(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(caret, caret);
        }
      }, 0);
    },
    [value, onChange],
  );

  /* ----- Imperative jump-to-line (#85, #115 integration) -----
     Resume Health surfaces "Jump to line N" / "Suggest a fix" buttons;
     clicking one tells ResumeStudio to drive the editor here. The handle
     exposes four narrow operations:

       - jumpToLine(line): focus + select the entire 1-based target line +
         scroll to it. Used by the original jump button.
       - jumpToOffender(line, offender): like jumpToLine, but selects the
         offender substring on that line (so the highlight reads as "this
         is the bit to change", not "this whole line is wrong").
       - insertRewriteAboveLine(targetLine, rewrittenLine): insert a new
         bullet line directly above the original, going through the same
         value/onChange path the in-editor rewrite tray (#93) uses.
       - jumpToSection(sectionTitle): scroll to and select the H2 heading
         whose title matches. Powers Health's "Open an example" affordance.

     Lines are 1-based to match what the analyzer emits. We clamp into range
     so a finding referring to a now-deleted line still does something
     sensible (snap to the nearest valid line).

     `value` and `onChange` live in the dependency array of the handle so a
     ref consumer always sees the live document — without this the insert
     callback would close over a stale `value` and clobber later edits. */
  useImperativeHandle(
    editorRef,
    () => {
      /** Resolve a 1-based line index into [start, end) char offsets. */
      function lineRange(line: number): {
        start: number;
        end: number;
        text: string;
        totalLines: number;
      } | null {
        const ta = textareaRef.current;
        if (!ta) return null;
        const text = ta.value;
        if (text.length === 0) return null;
        const parts = text.split('\n');
        const totalLines = parts.length;
        const clamped = Math.max(1, Math.min(line, totalLines));
        let start = 0;
        for (let i = 0; i < clamped - 1; i++) {
          start += parts[i].length + 1; // +1 for the consumed '\n'
        }
        const end = start + parts[clamped - 1].length;
        return { start, end, text: parts[clamped - 1], totalLines };
      }

      /** Approximate scroll: place the requested line near the top third. */
      function scrollToLine(line: number, totalLines: number) {
        const ta = textareaRef.current;
        if (!ta) return;
        const ratio = totalLines > 1 ? (line - 1) / Math.max(1, totalLines - 1) : 0;
        const maxScroll = Math.max(0, ta.scrollHeight - ta.clientHeight);
        ta.scrollTop = Math.round(maxScroll * ratio);
        if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
        if (overlayRef.current) overlayRef.current.scrollTop = ta.scrollTop;
      }

      return {
        jumpToLine(line: number) {
          const ta = textareaRef.current;
          if (!ta) return;
          if (ta.value.length === 0) {
            ta.focus();
            return;
          }
          const range = lineRange(line);
          if (!range) return;
          ta.focus();
          ta.setSelectionRange(range.start, range.end);
          const clamped = Math.max(1, Math.min(line, range.totalLines));
          scrollToLine(clamped, range.totalLines);
        },

        jumpToOffender(line: number, offender: string) {
          const ta = textareaRef.current;
          if (!ta) return;
          if (ta.value.length === 0) {
            ta.focus();
            return;
          }
          const range = lineRange(line);
          if (!range) return;
          ta.focus();
          // Case-insensitive find inside the target line. The selection lands
          // on the original casing the writer used (preserved from
          // `range.text`), not on the analyzer's normalized echo.
          const lower = range.text.toLowerCase();
          const idx = lower.indexOf(offender.toLowerCase());
          if (idx === -1) {
            // Fall back to selecting the whole line — the finding still
            // makes sense even if the user has since edited the offender.
            ta.setSelectionRange(range.start, range.end);
          } else {
            ta.setSelectionRange(range.start + idx, range.start + idx + offender.length);
          }
          const clamped = Math.max(1, Math.min(line, range.totalLines));
          scrollToLine(clamped, range.totalLines);
        },

        insertRewriteAboveLine(targetLine: number, rewrittenLine: string) {
          const ta = textareaRef.current;
          if (!ta) return;
          // Compute the line-start offset against the live document — we
          // cannot trust the textarea's `value` here because the controlled
          // component sources its text from React state.
          const parts = value.split('\n');
          const totalLines = parts.length;
          const clamped = Math.max(1, Math.min(targetLine, totalLines));
          let lineStart = 0;
          for (let i = 0; i < clamped - 1; i++) {
            lineStart += parts[i].length + 1; // +1 for the consumed '\n'
          }
          const inserted = `${rewrittenLine}\n`;
          const next = value.slice(0, lineStart) + inserted + value.slice(lineStart);
          onChange(next);

          // Defer focus + selection to after the controlled value has flushed
          // to the DOM, otherwise our setSelectionRange targets the stale text.
          window.setTimeout(() => {
            const t = textareaRef.current;
            if (!t) return;
            t.focus();
            // Select the inserted bullet so the writer can immediately see
            // what was added (and `Tab`-out / edit it inline).
            const selStart = lineStart;
            const selEnd = lineStart + rewrittenLine.length;
            t.setSelectionRange(selStart, selEnd);
            setCaret(selStart);
            // Re-derive the scroll target against the now-updated document.
            const newTotal = totalLines + 1;
            const ratio = newTotal > 1 ? (clamped - 1) / Math.max(1, newTotal - 1) : 0;
            const maxScroll = Math.max(0, t.scrollHeight - t.clientHeight);
            t.scrollTop = Math.round(maxScroll * ratio);
            if (gutterRef.current) gutterRef.current.scrollTop = t.scrollTop;
            if (overlayRef.current) overlayRef.current.scrollTop = t.scrollTop;
          }, 0);
        },

        jumpToSection(sectionTitle: string) {
          const ta = textareaRef.current;
          if (!ta) return;
          const text = ta.value;
          if (text.length === 0) {
            ta.focus();
            return;
          }
          // Match an H2 heading (`## Title`) case-insensitively against the
          // requested section title. No-op when the section isn't present
          // in the source — the editor stays where it is.
          const parts = text.split('\n');
          const want = sectionTitle.toLowerCase().trim();
          let target = -1;
          for (let i = 0; i < parts.length; i++) {
            const m = /^##\s+(?!#)(.+?)\s*$/.exec(parts[i]);
            if (m && m[1].toLowerCase().trim() === want) {
              target = i;
              break;
            }
          }
          if (target === -1) return;
          let start = 0;
          for (let i = 0; i < target; i++) start += parts[i].length + 1;
          const end = start + parts[target].length;
          ta.focus();
          ta.setSelectionRange(start, end);
          const ratio = parts.length > 1 ? target / Math.max(1, parts.length - 1) : 0;
          const maxScroll = Math.max(0, ta.scrollHeight - ta.clientHeight);
          ta.scrollTop = Math.round(maxScroll * ratio);
          if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
          if (overlayRef.current) overlayRef.current.scrollTop = ta.scrollTop;
        },
      };
    },
    [value, onChange],
  );

  return (
    <div className="editor">
      <div className="editor__bar">
        <label className="field-label editor__bar-label" htmlFor={textareaId}>
          Markdown source
        </label>

        <div className="editor__bar-controls">
          {/* ----- Always-visible quick-insert buttons (#70) -----
              Toolbar buttons — NOT menu items. They sit outside the
              popover's role="menu" container so they get the normal
              toolbar focus ring and tab order. On narrow viewports
              (<640px) they're hidden by CSS; the popover below still
              lists every snippet so nothing is unreachable. */}
          <div className="editor__quick-insert" role="group" aria-label="Insert section">
            {QUICK_SNIPPETS.map((snippet) => (
              <button
                key={snippet.id}
                type="button"
                className="btn btn--ghost editor__quick-insert-btn"
                onClick={() => insertSnippet(snippet)}
                aria-label={`Insert ${snippet.label}`}
              >
                <Icon name="plus" size={13} />
                {snippet.quickLabel}
              </button>
            ))}
          </div>

          {/* ----- Insert section popover (the long tail) ----- */}
          <div className="editor__snippet" ref={snippetWrapRef}>
            <button
              type="button"
              ref={snippetTriggerRef}
              className="btn btn--ghost editor__snippet-trigger"
              aria-haspopup="menu"
              aria-expanded={snippetOpen}
              aria-controls={snippetOpen ? snippetMenuId : undefined}
              onClick={() => setSnippetOpen((open) => !open)}
            >
              <Icon name="plus" size={13} />
              Insert section
            </button>
            {snippetOpen && (
              <ul
                id={snippetMenuId}
                className="editor__snippet-menu"
                role="menu"
                aria-label="Insert a resume section"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    closeSnippetMenu();
                  }
                }}
              >
                {SNIPPETS.map((snippet) => (
                  /* Snippets duplicated on the always-visible row carry
                     the --quick modifier; CSS hides them above 640px so
                     the popover shows only the long-tail entries on
                     wide viewports, but stays fully populated when the
                     quick row collapses on narrow ones. */
                  <li
                    key={snippet.id}
                    role="none"
                    className={
                      snippet.quickLabel
                        ? 'editor__snippet-li editor__snippet-li--quick'
                        : 'editor__snippet-li'
                    }
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="editor__snippet-item"
                      onClick={() => insertSnippet(snippet)}
                    >
                      {snippet.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ----- Soft-wrap toggle ----- */}
          <button
            type="button"
            className="btn btn--ghost editor__wrap-toggle"
            onClick={toggleSoftWrap}
            aria-pressed={softWrap}
            title={softWrap ? 'Soft-wrap is on' : 'Soft-wrap is off'}
          >
            <Icon name="wrap-text" size={13} />
            Wrap
          </button>
        </div>
      </div>

      <div className={`editor__surface${softWrap ? '' : ' editor__surface--nowrap'}`}>
        {/* Line-number gutter — purely decorative, hidden from assistive tech. */}
        <div className="editor__gutter" ref={gutterRef} aria-hidden="true">
          {gutterRows.map((n) => (
            <span className="editor__gutter-line" key={n}>
              {n}
            </span>
          ))}
        </div>
        {/* ----- Editor pane: overlay + textarea -----
            Inside the flex surface the gutter is the first column; the
            pane is the second. It wraps the overlay (#141) and the
            textarea so the overlay can position itself absolutely
            against the textarea's frame rather than the whole surface
            (which would leak the heading rail across the gutter). */}
        <div className="editor__pane">
        {/* ----- Structural overlay (#141) -----
            A purely decorative layer that sits behind the textarea and
            paints two subtle cues — a 2 px accent left-rail on heading
            lines, and a 1 px-tinted band over the leading frontmatter
            block. `aria-hidden` + `pointer-events: none` keep the
            textarea the controllable element; the overlay's
            `white-space: pre-wrap` (toggled to `pre` by `--nowrap`)
            mirrors the textarea so wrap behavior stays consistent. */}
        <div className="editor__overlay" ref={overlayRef} aria-hidden="true">
          {overlayRows.map((row) => {
            const classes = ['editor__overlay-line'];
            if (row.isHeading) classes.push('editor__overlay-heading');
            if (row.isFrontmatter) classes.push('editor__overlay-frontmatter');
            return (
              <div key={row.index} className={classes.join(' ')}>
                {row.text.length === 0 ? '\u00A0' : row.text}
              </div>
            );
          })}
        </div>
        <textarea
          id={textareaId}
          ref={textareaRef}
          className="editor__textarea"
          value={value}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          wrap={softWrap ? 'soft' : 'off'}
          placeholder={
            'Paste your resume Markdown here,\nor upload a file / load the sample above.'
          }
          aria-describedby={`${textareaId}-meta`}
          onChange={(event) => {
            onChange(event.target.value);
            setCaret(event.currentTarget.selectionStart);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onClick={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyUp={(event) => setCaret(event.currentTarget.selectionStart)}
          onBlur={() => {
            // When the textarea loses focus the affordance no longer makes
            // sense — but we must NOT close the tray if focus is moving
            // INTO it, so defer the clear and let the tray's own focus
            // win the race.
            window.setTimeout(() => {
              const active = document.activeElement;
              if (rewriteWrapRef.current?.contains(active)) return;
              setCaret(null);
            }, 0);
          }}
          onScroll={syncScroll}
        />
        </div>
      </div>

      {/* ----- Bullet-rewrite affordance (#93) -----
          Appears only when the caret is on an Experience bullet that has
          at least one applicable rewrite. Renders below the textarea —
          a single trigger button that opens a tray of 2-3 candidate
          rewrites. ESC closes the tray and returns focus to the trigger.
          A click on a candidate inserts a new sibling bullet above the
          original through the same value/onChange path as the snippet
          inserter, so there's no separate state-mutation pathway. */}
      {rewriteContext && (
        <div className="editor__rewrite" ref={rewriteWrapRef}>
          <button
            type="button"
            ref={rewriteTriggerRef}
            className="btn btn--ghost editor__rewrite-trigger"
            aria-haspopup="menu"
            aria-expanded={rewriteTrayOpen}
            aria-controls={rewriteTrayOpen ? rewriteTrayId : undefined}
            onClick={() => setRewriteTrayOpen((open) => !open)}
          >
            <Icon name="chevron-right" size={13} />
            Rewrite this bullet
            <span className="editor__rewrite-trigger-count">
              ({rewriteContext.candidates.length})
            </span>
          </button>
          {rewriteTrayOpen && (
            <ul
              id={rewriteTrayId}
              className="editor__rewrite-tray"
              role="menu"
              aria-label="Bullet rewrite suggestions"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  closeRewriteTray();
                }
              }}
            >
              {rewriteContext.candidates.map((candidate) => (
                <li key={candidate.id} role="none" className="editor__rewrite-li">
                  <button
                    type="button"
                    role="menuitem"
                    className="editor__rewrite-item"
                    onClick={() => applyRewrite(candidate)}
                  >
                    <span className="editor__rewrite-item-label">{candidate.label}</span>
                    <span className="editor__rewrite-item-preview">{candidate.rewrittenLine}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div id={`${textareaId}-meta`} className="editor__meta">
        <span>{lineCount} lines</span>
        <span>{charCount.toLocaleString()} chars</span>
      </div>
    </div>
  );
}

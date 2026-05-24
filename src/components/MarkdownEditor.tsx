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
}

interface MarkdownEditorProps {
  /** Current Markdown source string (controlled). */
  value: string;
  /** Called with the new value on every edit. */
  onChange: (value: string) => void;
  /** Imperative-handle ref. Optional — most callers don't need it. */
  editorRef?: Ref<MarkdownEditorHandle>;
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

export default function MarkdownEditor({ value, onChange, editorRef }: MarkdownEditorProps) {
  const textareaId = useId();
  const snippetMenuId = useId();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
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

  /* Keep the gutter's vertical scroll locked to the textarea's. */
  const syncScroll = useCallback(() => {
    const gutter = gutterRef.current;
    const textarea = textareaRef.current;
    if (gutter && textarea) {
      gutter.scrollTop = textarea.scrollTop;
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

  /* ----- Imperative jump-to-line (#85 integration) -----
     Resume Health surfaces "Jump to line N" buttons; clicking one tells
     ResumeStudio to drive the editor here. We focus the textarea, select
     the entire target line so the user sees a clear highlight, and scroll
     the viewport to the line proportionally to its position in the file.

     Lines are 1-based to match what the analyzer emits. We clamp into range
     so a finding referring to a now-deleted line still does something
     sensible (snap to the nearest valid line). */
  useImperativeHandle(
    editorRef,
    () => ({
      jumpToLine(line: number) {
        const ta = textareaRef.current;
        if (!ta) return;
        const text = ta.value;
        if (text.length === 0) {
          ta.focus();
          return;
        }
        // Find the start/end character offsets for the requested 1-based line.
        // `split('\n')` keeps newlines out of each entry, so the running offset
        // is the cumulative length plus one newline per preceding line.
        const parts = text.split('\n');
        const totalLines = parts.length;
        const clamped = Math.max(1, Math.min(line, totalLines));
        let start = 0;
        for (let i = 0; i < clamped - 1; i++) {
          start += parts[i].length + 1; // +1 for the consumed '\n'
        }
        const end = start + parts[clamped - 1].length;

        ta.focus();
        ta.setSelectionRange(start, end);

        // Approximate scroll: position the target line near the top third of
        // the viewport. Browsers don't expose per-line offsets cheaply, so we
        // pro-rate by line index over the textarea's total scrollHeight.
        const ratio = totalLines > 1 ? (clamped - 1) / Math.max(1, totalLines - 1) : 0;
        const maxScroll = Math.max(0, ta.scrollHeight - ta.clientHeight);
        ta.scrollTop = Math.round(maxScroll * ratio);
        // Keep the gutter aligned.
        if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
      },
    }),
    [],
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

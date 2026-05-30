/**
 * ResumeStudio — the React island root and single source of app state.
 *
 * Owns: the Markdown source string, the derived `ParsedResume` (recomputed
 * via `parseResume`, debounced on edits), the themes array, the current
 * theme, the theme search query / popover-open flag, the resume-safe-only
 * toggle, the export-panel-open flag, and the print mode.
 *
 * Two-phase journey (#43, #51-53): with no resume loaded the upload + editor
 * flow is the hero — the theme toolbar and shortcut legend are hidden, since
 * they operate on a resume that does not exist yet. Once a resume is present
 * the toolbar and legend are revealed, and the resume-acting shortcuts are
 * enabled.
 *
 * PRIVACY: resume content lives only in component state. It is never written
 * to storage and never put in the URL. Only the theme slug is persisted (via
 * storage.ts) and reflected into `?theme=`.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ParsedResume, PreviewMode, PrintMode, ResumeTemplate, ResumeTheme } from '../types';
import { DEFAULT_RESUME_TEMPLATE, RESUME_TEMPLATES, isResumeTemplate } from '../types';
import { parseResume } from '../utils/markdown';
import {
  applyThemeToDocument,
  findTheme,
  getAllThemes,
  getFallbackTheme,
  loadAllThemesAsync,
  resolveInitialThemeSlug,
  themesLoaded,
} from '../utils/themes';
import {
  clearDraft,
  deleteSnapshot,
  getDraft,
  getSnapshots,
  getStoredTemplate,
  isDraftPersistenceEnabled,
  saveSnapshot,
  setDraft,
  setDraftPersistenceEnabled,
  setStoredTemplate,
  setStoredThemeSlug,
  type ResumeSnapshot,
} from '../utils/storage';
import MarkdownUploader, { type MarkdownUploaderHandle } from './MarkdownUploader';
import MarkdownEditor, { type MarkdownEditorHandle } from './MarkdownEditor';
import ResumePreview from './ResumePreview';
import ResumeHealth from './ResumeHealth';
import StudioStatusLine from './StudioStatusLine';
import ChromeModeToggle from './ChromeModeToggle';
import ThemePicker from './ThemePicker';
import LayoutSelector from './LayoutSelector';
import ExportPanel from './ExportPanel';
import KeyboardHelp, { getStoredShortcutsEnabled, setStoredShortcutsEnabled } from './KeyboardHelp';
import ExampleDialog from './ExampleDialog';
import FormatDocsDialog from './FormatDocsDialog';
import PrintPreviewDialog from './PrintPreviewDialog';
import PageFitIndicator from './PageFitIndicator';
import TailorForRole from './TailorForRole';
import AppHero from './AppHero';
import SettingsDrawer from './SettingsDrawer';
import Icon from './Icon';
import Toast from './Toast';
import { wcagLevel } from '../utils/wcag';

/**
 * Number of starter templates shipped under `public/templates/*.md`. Used by
 * the empty-state hero (#127) to render the TEMPLATES stat counter. Kept as
 * a literal because Astro's static build inlines the public/ tree and the
 * count is small + stable. Bumped to 5 in #156 when the placeholder-only
 * Scaffold template was added.
 */
const STARTER_TEMPLATE_COUNT = 5;

/** sessionStorage key for the ATS preview mode (#31). */
const ATS_MODE_SESSION_KEY = 'womr:ats-mode';

/** Debounce window for re-parsing Markdown as the user types. */
const PARSE_DEBOUNCE_MS = 200;

/**
 * Debounce window for the arrow-key theme commit (#89).
 *
 * Holding ← / → previews the next theme on every keypress (synchronous, via
 * `applyThemeToDocument`), but defers the *commit* — URL write, storage
 * write, the preview-pane crossfade — until the user stops stepping for this
 * many milliseconds. 350 ms is long enough that mash-stepping through a
 * dozen themes counts as a single commit, and short enough that a deliberate
 * single press still feels immediate.
 */
const ARROW_COMMIT_DEBOUNCE_MS = 350;

/** Which tab the preview pane is currently showing (#85). */
type PreviewTab = 'preview' | 'health';

/** Tags whose keystrokes must NOT trigger app shortcuts. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** True when the user has not asked for reduced motion. */
function motionOk(): boolean {
  try {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

export default function ResumeStudio() {
  /* ----- Resume content state (in-memory only, never persisted) ----- */
  const [markdown, setMarkdown] = useState('');
  const [parsed, setParsed] = useState<ParsedResume | null>(null);
  const [sourceName, setSourceName] = useState('resume.md');
  /* Baseline markdown for the modeline's `●draft` indicator (#134)
     AND the document tab strip's dirty `●` indicator (#138). Single
     source of truth: any load path resets it; the tab strip and the
     modeline read the same `markdown !== baselineMarkdown` signal.
     Set on every load path (upload, sample, snapshot, draft restore, clear)
     so `markdown !== baseline` means "the user has typed something the
     current source state doesn't reflect yet". Stays a plain string so
     the equality check is O(1) on the reference for the common no-edit
     case and never deeper than a single string-compare otherwise. */
  const [baselineMarkdown, setBaselineMarkdown] = useState('');

  /* Caret position threaded into the status line (#134). MarkdownEditor
     emits 1-based line + column via its `onCaretChange` prop; we hold
     them at the parent so the modeline can render even when the editor
     is collapsed on mobile. `null` means "no caret yet" (or just blurred);
     the modeline omits its cursor segment in that state. */
  const [cursorLine, setCursorLine] = useState<number | null>(null);
  const [cursorColumn, setCursorColumn] = useState<number | null>(null);

  /* ----- Theme state -----
     The theme dataset is code-split (#78): it loads asynchronously via a
     dynamic import on mount. `themes` starts with whatever `getAllThemes()`
     returns synchronously (just `HARDCODED_FALLBACK` until the dataset is
     here) and is replaced with the full ~465 entries once
     `loadAllThemesAsync()` resolves. `themesReady` toggles when the load
     finishes — the picker reads it to show a brief loading state.

     #153 dropped the 80 themes whose body-text contrast fell below the
     resume-safe 7:1 threshold; the picker's matching "Resume-safe themes
     only" toggle went with them (every remaining theme is safe by
     construction, so the toggle was a permanent no-op), which is why
     there is no `resumeSafeOnly` state in this hook block. */
  const [themes, setThemes] = useState<ResumeTheme[]>(() => getAllThemes());
  const [themesReady, setThemesReady] = useState<boolean>(() => themesLoaded());
  const [theme, setTheme] = useState<ResumeTheme | null>(null);
  const [themeQuery, setThemeQuery] = useState('');
  const [themePickerOpen, setThemePickerOpen] = useState(false);

  /* ----- UI state ----- */
  const [exportOpen, setExportOpen] = useState(false);
  const [printMode, setPrintMode] = useState<PrintMode>('conservative');
  const [loadAnnouncement, setLoadAnnouncement] = useState('');

  /* ----- Print preview modal (#185) -----
     Additive to the existing toolbar Save-as-PDF shortcut. A separate
     Preview button opens this modal; the modal embeds the standalone HTML
     export in a sandboxed iframe, threads the same `printMode` state in via
     a radio group (so the page-fit chip's mode dropdown and the modal stay
     in lockstep — single source of truth), and offers Save-as-PDF as the
     primary action inside the modal. Trigger ref lets focus return to the
     Preview button on close. */
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const printPreviewTriggerRef = useRef<HTMLButtonElement>(null);

  /* ----- Per-session body-font shift (#186) -----
     The A- / A+ controls next to the Fit chip nudge the resume body font
     size by ±0.5pt against an 11pt baseline, clamped to ±2pt. Session-only
     (no storage), consistent with the print-mode policy: a tweak made while
     tuning a resume isn't a long-term setting. The value flows out to
     `.resume-preview` via a CSS custom property — applied below in a
     useLayoutEffect so the shift paints in the same frame the state lands. */
  const [bodySizeShift, setBodySizeShift] = useState(0);

  /* ----- Overwrite toast (#77) — visible companion to the aria-live
     announcement for sighted users. `toast` is null when nothing is
     showing; setting it (with a monotonically increasing `id`) shows a
     fresh toast and resets the auto-dismiss timer. Only set on the
     overwrite path, NOT on the generic "Resume loaded" path. */
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  // Stable across renders — the toast's auto-dismiss effect lists this in its
  // dependency array, so an inline arrow would restart the 5 s timer on every
  // parent re-render (e.g. the debounced parse on every keystroke).
  const dismissToast = useCallback(() => setToast(null), []);
  const toastIdRef = useRef(0);

  /* ----- Layout template (#30) — persisted via localStorage + URL.
     The initial value is the safe default so SSR and the first client
     render agree; the mount-time effect below promotes the value from
     URL > storage > default once the client is alive. */
  const [template, setTemplate] = useState<ResumeTemplate>(DEFAULT_RESUME_TEMPLATE);

  /* ----- ATS preview mode (#31) — persisted for the session only.
     Sessions match the user's mental model: "I'm looking at this as an
     ATS while I tweak the resume" doesn't deserve a long-term setting.
     Default off; the mount-time effect reads sessionStorage. */
  const [previewMode, setPreviewMode] = useState<PreviewMode>('normal');

  /* ----- Keyboard-shortcut help overlay (#58) ----- */
  const [helpOpen, setHelpOpen] = useState(false);

  /* ----- Mobile "More" menu (#131) -----
     On viewports < 640px the toolbar wraps to four+ rows and pushes the
     resume header out of frame. The fix collapses everything except
     ThemePicker + Save-as-PDF behind a single "More" trigger that opens a
     vertically-stacked drawer over the toolbar. State is a single boolean;
     CSS does the heavy lifting via a data attribute on the toolbar root.
     Default off so SSR and first-paint agree. */
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const mobileMoreTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileMoreDrawerRef = useRef<HTMLDivElement>(null);

  /* ----- Settings drawer (#128) -----
     Right-anchored modal drawer that holds low-frequency controls (ATS
     toggle, draft autosave, clear workspace, snapshots, theme nav, shortcut
     legend). Opens from the gear icon at the rightmost toolbar slot. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const formatDocsTriggerRef = useRef<HTMLElement | null>(null);

  /* ----- Markdown format reference dialog (#157, #198) -----
     Static "what shape does this app expect" reference: frontmatter contract,
     canonical sections, an LLM-handoff prompt with a copy-to-clipboard
     affordance, and the privacy reminder. Opened from the Settings drawer's
     Help group in Phase 2, and from the empty-state hero in Phase 1. */
  const [formatDocsOpen, setFormatDocsOpen] = useState(false);

  /* ----- "Open an example" dialog (#120) -----
     When the Resume Health panel asks to open an example for a section the
     writer's resume DOESN'T have, we open this dialog rather than no-op.
     Null when closed; otherwise carries the H2 section name to show. The
     section presence check happens in `handleJumpToSection` below — Health
     just hands the section name up, and the parent picks editor-jump vs
     dialog. */
  const [exampleSection, setExampleSection] = useState<string | null>(null);
  /* The button that opened the dialog, so focus can return on close. */
  const exampleTriggerRef = useRef<HTMLElement | null>(null);
  /* Single-key shortcuts can be disabled for WCAG 2.1.4 mitigation. The
     stored preference is read once on mount (after hydration) to avoid an
     SSR/client mismatch — default `true` until then. */
  const [shortcutsEnabled, setShortcutsEnabled] = useState(true);

  /* ----- Opt-in draft persistence (#32) -----
     Default OFF: the privacy banner promises nothing is persisted by
     default. The state is read once on mount (after hydration) so SSR and
     the client agree; until then we treat it as off. `draftRestored` gates
     the autosave effect so we don't overwrite the restored draft with an
     empty initial `markdown` before the restore has had a chance to run. */
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);

  /* ----- Resume version snapshots (#94) -----
     Local, gated on the same opt-in as draft autosave. The list is hydrated
     from storage once on mount (alongside the draft restore) and then kept
     in lockstep with storage via the save / delete callbacks. Empty when
     the gate is off. */
  const [snapshots, setSnapshots] = useState<ResumeSnapshot[]>([]);

  const themeSearchInputId = useId();
  const draftCheckboxId = useId();
  /* IDs the preview/health tab control uses for aria-controls + aria-labelledby
     so screen readers can announce the active tab and which region it owns. */
  const previewTabId = useId();
  const healthTabId = useId();
  const previewPanelId = useId();
  const healthPanelId = useId();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Debounce timer for arrow-key theme stepping (#89). On every ← / → step we
     apply the next theme to the document synchronously and reset this timer;
     when it fires we commit the (now-stable) theme through `changeTheme`
     (URL + storage + crossfade). `r` (random) intentionally bypasses this. */
  const arrowDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* The theme we're previewing under the debounce — `null` when no preview
     is in flight. Read by the commit callback so a stale `theme` closure
     can't lie about which theme should be committed. */
  const pendingThemeRef = useRef<ResumeTheme | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const editorPaneRef = useRef<HTMLDetailsElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const helpTriggerRef = useRef<HTMLButtonElement>(null);
  /* Imperative handle for "Jump to line N" from the Resume Health panel.
     ResumeStudio owns this ref because Health and the editor live in
     sibling sub-trees (the split panes); the ref is the cross-pane bridge. */
  const editorHandleRef = useRef<MarkdownEditorHandle>(null);
  /* Imperative handle into the uploader, used to drive its file picker
     from the editor tab strip's "Replace file" button (#138). The
     uploader still owns the hidden <input type="file"> and its
     read/parse pipeline; the tab strip is just a new trigger. */
  const uploaderHandleRef = useRef<MarkdownUploaderHandle>(null);

  /* Mobile editor accordion state (#100). Controlled: `open` flows from
     state into the `<details>` element, and the element's native onToggle
     event flows back here when the user taps the summary. The only
     non-user driver is the `hasResume` transition below — when a resume
     loads we auto-collapse so the preview is the first thing on mobile.
     CSS forces the body visible on the side-by-side desktop layout
     (≥ 961px) regardless of state, so the React-controlled `open` is
     genuinely just the stacked-layout accordion's open/closed state. */
  const [editorOpen, setEditorOpen] = useState<boolean>(true);
  /* Tracks the previous `hasResume` so we only auto-collapse/auto-open on
     a transition — leaving the user's mid-session toggles alone. */
  const prevHasResumeRef = useRef<boolean>(false);

  /* Which tab the preview pane is showing (#85). Default to the resume
     itself; users switch to Health when they want feedback. */
  const [previewTab, setPreviewTab] = useState<PreviewTab>('preview');
  /* The Preview/Health tablist uses roving tabindex, so per the WAI-ARIA
     Tabs pattern Left/Right/Home/End must move selection + focus (#196). */
  const previewTablistRef = useRef<HTMLDivElement>(null);
  const handlePreviewTabsKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const order: PreviewTab[] = ['preview', 'health'];
      const current = order.indexOf(previewTab);
      let nextIndex: number;
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          nextIndex = (current + 1) % order.length;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          nextIndex = (current - 1 + order.length) % order.length;
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = order.length - 1;
          break;
        default:
          return;
      }
      // preventDefault marks the event handled so the window-level theme
      // shortcut (←/→) backs off; stopPropagation is belt-and-braces.
      event.preventDefault();
      event.stopPropagation();
      const next = order[nextIndex];
      if (next !== previewTab) setPreviewTab(next);
      // Automatic activation: focus follows selection to the chosen tab.
      previewTablistRef.current
        ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
        ?.[nextIndex]?.focus();
    },
    [previewTab],
  );

  /** A resume is present once Markdown has been entered. */
  const hasResume = markdown.trim() !== '';
  const lineCount = markdown.length === 0 ? 0 : markdown.split('\n').length;

  /* ---------------------------------------------------------------- *
   * Mount: resolve and apply the initial theme. Deferred lazy-load    *
   * of the full dataset (#78, #80).                                   *
   *                                                                   *
   * Two-stage so first paint is never blocked on the ~600 kB JSON     *
   * chunk:                                                            *
   *                                                                   *
   *   1. Sync: resolve from URL/storage/curated and apply             *
   *      `HARDCODED_FALLBACK` (the only theme available before the    *
   *      dataset loads). For a URL or stored slug we hold the slug    *
   *      and reapply post-load — `findTheme` returns undefined for    *
   *      now since the cache is empty.                                *
   *   2. Async: dynamic-import the dataset on `requestIdleCallback`   *
   *      (falling back to `setTimeout` on Safari), hand the full      *
   *      list to state, and re-resolve the active theme so a          *
   *      `?theme=foo` URL ends up displaying `foo` rather than the    *
   *      boot fallback.                                                *
   *                                                                   *
   * Why idle, not eager (#80): the ThemePicker also triggers          *
   * `loadAllThemesAsync()` the first time the popover opens — the     *
   * same memoized promise — so a user who never browses themes pays   *
   * nothing for the chunk. But a user with `?theme=tomorrow-night-    *
   * blue` (or a stored slug not in HARDCODED_FALLBACK) never opens    *
   * the picker; they just want their saved theme applied. The idle    *
   * callback honors that invariant — the dataset still loads, just    *
   * not until after the resume preview has painted, so it never       *
   * costs first-paint latency.                                         *
   * ---------------------------------------------------------------- */
  useEffect(() => {
    const slug = resolveInitialThemeSlug();
    const initial = findTheme(slug) ?? getFallbackTheme(matchesDark());
    setTheme(initial);
    applyThemeToDocument(initial);

    let cancelled = false;
    // Promise the post-load resolve/apply step, regardless of which trigger
    // (idle-callback here, or ThemePicker open) actually kicks off the
    // dynamic import. Both call paths share the memoized `loadPromise` in
    // themes.ts, so this `.then` chain runs exactly once.
    function applyOnceLoaded(): void {
      loadAllThemesAsync()
        .then((all) => {
          if (cancelled) return;
          setThemes(all);
          setThemesReady(true);
          // Re-resolve the active theme now that the full dataset is here.
          // If the URL/stored slug points at a real theme we did not have
          // synchronously, swap it in (and re-apply). Otherwise leave the
          // boot fallback alone — the user hasn't expressed an opinion yet.
          const resolved = resolveInitialThemeSlug();
          const real = findTheme(resolved);
          if (real && real.slug !== initial.slug) {
            setTheme(real);
            applyThemeToDocument(real);
          }
          // Expose a small deterministic signal on <html> so e2e tests can
          // wait for the dataset to be in place before asserting on theme
          // state. Cheap, idempotent, and invisible to users.
          if (typeof document !== 'undefined') {
            document.documentElement.dataset.themesReady = 'true';
          }
        })
        .catch(() => {
          // Network / chunk-load failure: keep the boot fallback. The picker
          // remains usable on just the fallback theme — degraded but legible.
        });
    }

    // Defer the trigger until the browser is idle (or ~200 ms have passed on
    // engines without `requestIdleCallback`, notably Safari). This lets the
    // resume preview paint first; the picker can also trigger the same load
    // earlier if the user opens it — `loadAllThemesAsync` dedupes either way.
    let handle: number;
    const useIdle = 'requestIdleCallback' in window;
    if (useIdle) {
      handle = window.requestIdleCallback(applyOnceLoaded);
    } else {
      handle = window.setTimeout(applyOnceLoaded, 200);
    }

    return () => {
      cancelled = true;
      if (useIdle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, []);

  /* ---------------------------------------------------------------- *
   * Mount: resolve the initial layout template (#30).                 *
   * Priority order: ?layout=<slug> > localStorage > default.          *
   * Same SSR-parity pattern as the theme: read once in an effect so   *
   * server and first client paint agree.                              *
   * ---------------------------------------------------------------- */
  useEffect(() => {
    let resolved: ResumeTemplate = DEFAULT_RESUME_TEMPLATE;

    // 1. URL parameter.
    try {
      if (typeof window !== 'undefined' && window.location?.search) {
        const params = new URLSearchParams(window.location.search);
        const fromUrl = params.get('layout');
        if (fromUrl && isResumeTemplate(fromUrl)) {
          resolved = fromUrl;
        } else {
          // 2. localStorage (only if the URL did not provide one).
          const stored = getStoredTemplate();
          if (stored && isResumeTemplate(stored)) resolved = stored;
        }
      } else {
        const stored = getStoredTemplate();
        if (stored && isResumeTemplate(stored)) resolved = stored;
      }
    } catch {
      /* malformed query / blocked storage — fall back to the default */
    }

    setTemplate(resolved);
  }, []);

  /* ---------------------------------------------------------------- *
   * Mount: resolve the initial ATS preview mode (#31).                *
   * sessionStorage only — a viewing mode, not a saved preference.     *
   * ---------------------------------------------------------------- */
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      const stored = window.sessionStorage.getItem(ATS_MODE_SESSION_KEY);
      if (stored === 'ats') setPreviewMode('ats');
    } catch {
      /* sessionStorage may be blocked; default to normal mode */
    }
  }, []);

  /* ---------------------------------------------------------------- *
   * Mount: load the persisted "single-key shortcuts" preference.      *
   * Done in an effect (not lazy init) so the server and first client  *
   * render agree — localStorage is client-only.                       *
   * ---------------------------------------------------------------- */
  useEffect(() => {
    setShortcutsEnabled(getStoredShortcutsEnabled());
  }, []);

  /* ---------------------------------------------------------------- *
   * Mount: read opt-in draft state and (only when opted in) restore   *
   * the saved Markdown. Done in an effect for the same SSR-parity     *
   * reason as the shortcuts preference. The `draftRestored` flag      *
   * unblocks the autosave effect once restoration has had its turn.   *
   * ---------------------------------------------------------------- */
  useEffect(() => {
    const enabled = isDraftPersistenceEnabled();
    setDraftEnabled(enabled);
    if (enabled) {
      const saved = getDraft();
      if (saved && saved.length > 0) {
        setMarkdown(saved);
        // A restored draft is, by definition, the baseline of the next
        // session — without this the modeline's ●draft pill would flash
        // on first paint (#134), and the editor tab strip's dirty `●`
        // would light up on the first idle re-render (#138).
        setBaselineMarkdown(saved);
        setSourceName('saved-draft.md');
        setLoadAnnouncement('Restored your saved draft.');
      }
      // Snapshots (#94) live behind the same gate — only hydrate when the
      // user has opted in. `getSnapshots()` itself enforces this, but
      // calling it conditionally avoids an extra storage hit when off.
      setSnapshots(getSnapshots());
    }
    setDraftRestored(true);
  }, []);

  /* ---------------------------------------------------------------- *
   * Mobile editor accordion (#100): set `open` on hasResume transitions.*
   *                                                                   *
   * Mounts with the right initial state, then only writes the attribute*
   * when hasResume CHANGES — so the user's native summary clicks       *
   * (which flip `open` on the element directly) are never overridden by*
   * a stale React render. Two transitions matter:                      *
   *                                                                   *
   *   - false → true (resume loaded): collapse the accordion so the    *
   *     preview is the first thing the user sees while stacked. Side-  *
   *     by-side desktop is unaffected — CSS forces the body visible at *
   *     ≥ 961px.                                                        *
   *   - true → false (cleared): re-open so the empty Phase 1 editor IS *
   *     visible again, including on mobile.                            *
   * ---------------------------------------------------------------- */
  useEffect(() => {
    // Only act on a real transition — never on incidental re-renders, so
    // the user's mid-session summary taps aren't overridden.
    if (prevHasResumeRef.current === hasResume) return;
    prevHasResumeRef.current = hasResume;
    setEditorOpen(!hasResume);
  }, [hasResume]);

  /** Status-line caret observer (#134). Stable reference so MarkdownEditor's
      caret-change effect doesn't re-fire on every parent render. */
  const handleCaretChange = useCallback((line: number | null, column: number | null) => {
    setCursorLine(line);
    setCursorColumn(column);
  }, []);

  /** Toggle single-key shortcuts and persist the choice. */
  const changeShortcutsEnabled = useCallback((enabled: boolean) => {
    setShortcutsEnabled(enabled);
    setStoredShortcutsEnabled(enabled);
  }, []);

  /**
   * Toggle draft persistence (#32).
   * - Off → on: persist the current Markdown immediately so the next reload
   *   restores what's on screen. The flag is set BEFORE the body so the
   *   safety belt inside `setDraft` allows the write.
   * - On → off: purge both the flag and the stored body synchronously, so
   *   nothing is left behind after the user opts out.
   */
  const changeDraftEnabled = useCallback(
    (enabled: boolean) => {
      setDraftEnabled(enabled);
      setDraftPersistenceEnabled(enabled);
      if (enabled) {
        // Capture whatever is on screen right now so the opt-in feels
        // immediate rather than "this will save what you type next".
        if (markdown.length > 0) setDraft(markdown);
        // Snapshots are gated on the same flag (#94). On opt-IN there is
        // nothing in storage yet, but rehydrate the in-memory list anyway
        // so a future opt-out → opt-in cycle stays consistent.
        setSnapshots(getSnapshots());
        setLoadAnnouncement('Draft saving is on for this device.');
      } else {
        // The opt-out path in storage.ts already purges the snapshots key
        // (#94). Mirror that in component state so the popover empties
        // without a reload.
        setSnapshots([]);
        setLoadAnnouncement('Draft saving is off. Any saved draft was removed from this device.');
      }
    },
    [markdown],
  );

  /* ---------------------------------------------------------------- *
   * Reflect print mode onto <body> so print.css can react.            *
   * ---------------------------------------------------------------- */
  useEffect(() => {
    document.body.dataset.printMode = printMode;
  }, [printMode]);

  /* ---------------------------------------------------------------- *
   * Reflect the body-font shift (#186) onto the document root via the *
   * `--resume-body-size-shift` custom property. `resume.css` consumes  *
   * the property in the base `.resume-preview` font-size rule (and in  *
   * the compact template), so both the on-screen preview AND the       *
   * printed PDF pick it up — the print stylesheet inherits the base    *
   * rule because we no longer pin `font-size: 11pt` in `print.css`.    *
   *                                                                    *
   * CSP: the property is set via CSSOM on `documentElement.style` from *
   * a `useLayoutEffect` — same pattern as ThemeSwatch / AccentDot. No  *
   * JSX `style={...}` attribute, so `style-src 'unsafe-inline'` stays  *
   * forbidden. The shift is cleared on unmount so a hot-reload during  *
   * development doesn't leave a stale variable on the root.            *
   * ---------------------------------------------------------------- */
  useLayoutEffect(() => {
    document.documentElement.style.setProperty(
      '--resume-body-size-shift',
      `${bodySizeShift}pt`,
    );
    return () => {
      document.documentElement.style.removeProperty('--resume-body-size-shift');
    };
  }, [bodySizeShift]);

  /* ---------------------------------------------------------------- *
   * Reflect the empty-state hero / loaded-workbench phase onto <body> *
   * via `data-app-phase` (#127). The CSS rule                         *
   *   body[data-app-phase='hero'] .app-header { display: none; }      *
   * hides the static AppHeader astro chrome while the React-driven    *
   * hero is the loud landing presence, avoiding a double-rendered     *
   * brand row. On unmount the attribute is cleared.                   *
   * ---------------------------------------------------------------- */
  useEffect(() => {
    document.body.dataset.appPhase = hasResume ? 'workbench' : 'hero';
    return () => {
      delete document.body.dataset.appPhase;
    };
  }, [hasResume]);

  /**
   * Change the active layout template (#30). Persists to localStorage and
   * reflects into the URL as `?layout=<slug>`, the same shape as `?theme=`
   * so a permalink preserves both choices.
   */
  const changeTemplate = useCallback((next: ResumeTemplate) => {
    setTemplate(next);
    setStoredTemplate(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('layout', next);
      window.history.replaceState(null, '', url);
    } catch {
      /* URL update is cosmetic — ignore failures. */
    }
  }, []);

  /**
   * Toggle ATS preview mode (#31). Persists for the session only — when the
   * user reopens the tab the preview returns to normal. Theme switching
   * remains live in the toolbar but is intentionally muted in the preview.
   */
  const changePreviewMode = useCallback((active: boolean) => {
    const next: PreviewMode = active ? 'ats' : 'normal';
    setPreviewMode(next);
    try {
      if (typeof window !== 'undefined') {
        if (next === 'ats') {
          window.sessionStorage.setItem(ATS_MODE_SESSION_KEY, 'ats');
        } else {
          window.sessionStorage.removeItem(ATS_MODE_SESSION_KEY);
        }
      }
    } catch {
      /* sessionStorage blocked — ignore */
    }
    setLoadAnnouncement(
      next === 'ats'
        ? 'ATS preview on. Showing a plain, single-column rendering; theme is muted.'
        : 'ATS preview off. Theme and layout restored.',
    );
  }, []);

  /* ---------------------------------------------------------------- *
   * Debounced Markdown parsing. parseResume is sync + browser-only.   *
   * ---------------------------------------------------------------- */
  useEffect(() => {
    if (markdown.trim() === '') {
      // Empty editor → empty state. Cancel any pending parse.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setParsed(null);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setParsed(parseResume(markdown));
    }, PARSE_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [markdown]);

  /* ---------------------------------------------------------------- *
   * Debounced draft autosave (#32). Only runs when:                   *
   *   - the mount-time restore has already happened (so we don't      *
   *     blow the saved draft away with an empty initial value), AND   *
   *   - the user has opted in.                                        *
   * An empty Markdown body purges the stored draft so an empty editor *
   * never persists a stale resume.                                    *
   * ---------------------------------------------------------------- */
  useEffect(() => {
    if (!draftRestored) return;
    if (!draftEnabled) return;
    if (draftDebounceRef.current) clearTimeout(draftDebounceRef.current);
    draftDebounceRef.current = setTimeout(() => {
      if (markdown.length === 0) {
        clearDraft();
      } else {
        setDraft(markdown);
      }
    }, PARSE_DEBOUNCE_MS);
    return () => {
      if (draftDebounceRef.current) clearTimeout(draftDebounceRef.current);
    };
  }, [markdown, draftEnabled, draftRestored]);

  /* ---------------------------------------------------------------- *
   * Theme change: apply to document, persist slug, reflect into URL.  *
   * A brief opacity dip on the preview makes the switch feel designed *
   * rather than a flicker (reduced-motion users get an instant swap). *
   * ---------------------------------------------------------------- */
  const changeTheme = useCallback((next: ResumeTheme) => {
    // Any pending arrow-step commit is superseded by an explicit commit
    // (#89). Clearing here is defensive — `stepTheme`'s timer fires this
    // callback itself, so the timer ref is usually already null by the
    // time we land here. But a picker selection or a Random press also
    // routes through changeTheme; for those paths we must drop the timer.
    if (arrowDebounceRef.current) {
      clearTimeout(arrowDebounceRef.current);
      arrowDebounceRef.current = null;
    }
    pendingThemeRef.current = null;

    setTheme(next);
    applyThemeToDocument(next);
    setStoredThemeSlug(next.slug);

    const preview = previewRef.current;
    if (preview && motionOk()) {
      preview.classList.remove('studio__pane--theming');
      // Force a reflow so the animation restarts on rapid theme steps.
      void preview.offsetWidth;
      preview.classList.add('studio__pane--theming');
    }

    try {
      const url = new URL(window.location.href);
      url.searchParams.set('theme', next.slug);
      window.history.replaceState(null, '', url);
    } catch {
      /* URL update is cosmetic — ignore failures. */
    }
  }, []);

  /* ----- Theme navigation helpers -----
     `stepTheme` is the arrow-key entry point. To keep mash-stepping cheap
     (#89) it splits the work into two paths:

       - PREVIEW (synchronous, every keypress): set React state so the UI
         reflects the new theme name + WCAG badge, and apply the theme to
         the document so the resume re-paints. NO URL write, NO storage
         write, NO crossfade animation — those are commit-side concerns.
       - COMMIT (debounced, 350 ms after the last step): run the existing
         `changeTheme` which handles URL + storage + the crossfade. The
         debounce timer is reset on every keypress and on unmount.

     Toolbar prev/next buttons share this path, so a button-mash also
     debounces. A real selection from the picker (the `choose` path) still
     goes through `changeTheme` directly, bypassing the debounce. */
  const stepTheme = useCallback(
    (delta: number) => {
      if (!theme || themes.length === 0) return;
      // Step from the *currently-previewed* theme so two ← in a row move two
      // steps, not one. Falls back to the committed theme when no preview is
      // in flight.
      const base = pendingThemeRef.current ?? theme;
      const index = themes.findIndex((t) => t.slug === base.slug);
      const baseIndex = index === -1 ? 0 : index;
      const nextIndex = (baseIndex + delta + themes.length) % themes.length;
      const next = themes[nextIndex];
      if (!next) return;

      // Preview path — reflect in React state + the document, nothing else.
      pendingThemeRef.current = next;
      setTheme(next);
      applyThemeToDocument(next);

      // Reset the commit timer.
      if (arrowDebounceRef.current) clearTimeout(arrowDebounceRef.current);
      arrowDebounceRef.current = setTimeout(() => {
        const pending = pendingThemeRef.current;
        pendingThemeRef.current = null;
        arrowDebounceRef.current = null;
        if (pending) changeTheme(pending);
      }, ARROW_COMMIT_DEBOUNCE_MS);
    },
    [theme, themes, changeTheme],
  );

  /* On unmount: cancel any pending commit. The previewed theme is already
     applied to the document, so nothing visual is lost — we just don't
     persist a choice the user never finished making. */
  useEffect(() => {
    return () => {
      if (arrowDebounceRef.current) clearTimeout(arrowDebounceRef.current);
    };
  }, []);

  const randomTheme = useCallback(() => {
    if (themes.length === 0) return;
    // Random is an intentional, single-shot pick — commit immediately. If a
    // pending arrow-step commit is in flight, drop it (the random pick is
    // the user's new intent).
    if (arrowDebounceRef.current) {
      clearTimeout(arrowDebounceRef.current);
      arrowDebounceRef.current = null;
      pendingThemeRef.current = null;
    }
    let pick = themes[Math.floor(Math.random() * themes.length)];
    // Avoid picking the current theme when there's a choice.
    if (themes.length > 1 && theme && pick.slug === theme.slug) {
      pick = themes[(themes.indexOf(pick) + 1) % themes.length];
    }
    if (pick) changeTheme(pick);
  }, [themes, theme, changeTheme]);

  /* On close of the settings drawer (#128), restore focus to the gear button
     so a keyboard user lands where they started. Declared ahead of the
     global keydown effect so the Escape branch can reference it without a
     temporal-dead-zone error (#131 build fix). */
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    window.setTimeout(() => settingsTriggerRef.current?.focus(), 0);
  }, []);

  /* ---------------------------------------------------------------- *
   * Global keyboard shortcuts.                                        *
   * Escape ALWAYS works — it is never gated, so a panel can always be *
   * dismissed by keyboard. The remaining shortcuts (theme nav, /,     *
   * print, export, ?) are gated three ways:                           *
   *   1. They act on a resume — ignored in the empty Phase 1 state.   *
   *   2. They are silenced while the help overlay is open (it owns    *
   *      its own keyboard handling, including its focus trap).        *
   *   3. WCAG 2.1.4: when `shortcutsEnabled` is false the single-key  *
   *      shortcuts are fully disabled (only Escape survives).          *
   * ---------------------------------------------------------------- */
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Escape always works: close panels, blur the active field.
      if (event.key === 'Escape') {
        if (exportOpen) setExportOpen(false);
        if (themePickerOpen) setThemePickerOpen(false);
        // The Settings drawer (#128) owns its own Escape handling — focus
        // trap, nested-popover deference (SnapshotsMenu's inner popover
        // closes BEFORE the drawer does). Calling closeSettings() from
        // the global handler would race that logic and skip the popover-
        // level Esc step. The drawer's own onClose path restores focus
        // to the gear button when it closes.
        if (isEditableTarget(event.target)) {
          (event.target as HTMLElement).blur();
        }
        return;
      }

      // The help overlay, settings drawer, format-docs dialog, and the
      // print-preview modal each trap focus and handle their own keys — let
      // them own the keyboard while open. Escape inside any of them is
      // handled by the modal itself (which calls onClose); the global
      // Escape handler above short-circuits before this guard.
      if (helpOpen) return;
      if (settingsOpen) return;
      if (formatDocsOpen) return;
      if (printPreviewOpen) return;

      // If a closer handler already acted on this key (e.g. the Preview/
      // Health tablist's Arrow navigation, #196), don't also fire a global
      // shortcut for it.
      if (event.defaultPrevented) return;

      // Never hijack typing, and never fight browser/OS chords.
      if (isEditableTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // WCAG 2.1.4 mitigation: all single-key shortcuts are off when the
      // user has disabled them in the help overlay.
      if (!shortcutsEnabled) return;

      // All remaining shortcuts act on a resume — ignore them in Phase 1.
      if (!hasResume) return;

      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          stepTheme(-1);
          break;
        case 'ArrowRight':
          event.preventDefault();
          stepTheme(1);
          break;
        case '/':
          event.preventDefault();
          setThemePickerOpen(true);
          break;
        case 'r':
          event.preventDefault();
          randomTheme();
          break;
        case 'p':
          event.preventDefault();
          window.print();
          break;
        case 'e':
          event.preventDefault();
          setExportOpen((open) => !open);
          break;
        case '?':
          event.preventDefault();
          setHelpOpen(true);
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    exportOpen,
    themePickerOpen,
    helpOpen,
    settingsOpen,
    formatDocsOpen,
    printPreviewOpen,
    hasResume,
    shortcutsEnabled,
    stepTheme,
    randomTheme,
  ]);

  /* ---------------------------------------------------------------- *
   * Mobile More menu (#131): non-modal dismissal.                     *
   * Outside-click closes the drawer; Escape closes it and restores    *
   * focus to the trigger. The drawer is purely a mobile reorg, so we  *
   * also auto-close when the viewport widens past 640px — otherwise   *
   * a user rotating into landscape would be left looking at a stale   *
   * fixed drawer covering a desktop layout that no longer needs it.   *
   * ---------------------------------------------------------------- */
  useEffect(() => {
    if (!mobileMoreOpen) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (mobileMoreDrawerRef.current?.contains(target)) return;
      if (mobileMoreTriggerRef.current?.contains(target)) return;
      setMobileMoreOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      /* The drawer hosts other popovers (Page-fit, Export, Settings).
         Each of those owns its own Escape handler that closes itself and
         restores focus to ITS trigger inside the drawer. Document-level
         listeners are siblings, not ancestors, so `stopPropagation` from
         a child popover does NOT prevent this one from also firing.
         Guard by checking what just received focus: if focus landed on a
         control INSIDE the drawer (a child popover closed), leave the
         drawer open. Only close when focus is outside the drawer or
         already on the More trigger itself. */
      if (typeof document !== 'undefined') {
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          mobileMoreDrawerRef.current?.contains(active) &&
          active !== mobileMoreTriggerRef.current
        ) {
          // A drawer-internal control just received focus — that's a
          // child-popover-close, not a drawer-dismiss.
          return;
        }
      }
      setMobileMoreOpen(false);
      mobileMoreTriggerRef.current?.focus();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileMoreOpen]);

  useEffect(() => {
    if (!mobileMoreOpen) return;
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(min-width: 640px)');
    function handle(event: MediaQueryListEvent) {
      if (event.matches) setMobileMoreOpen(false);
    }
    // Defensive: if the listener attaches after the user already crossed
    // the breakpoint (e.g. via devtools snap), close immediately.
    if (mql.matches) {
      setMobileMoreOpen(false);
      return;
    }
    mql.addEventListener('change', handle);
    return () => mql.removeEventListener('change', handle);
  }, [mobileMoreOpen]);

  /* On close of the help overlay, restore focus to whatever opened it.
     After the #128 consolidation the toolbar no longer carries a dedicated
     keyboard-shortcuts icon button — the dialog is opened either from
     inside the Settings drawer's Help section, or via the `?` global
     shortcut. `helpTriggerRef` remains for forward-compatibility (in case
     the icon is reintroduced); when it's null, the focus restore falls
     back to the Settings gear, which is the closest sensible target. */
  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    window.setTimeout(() => {
      const target = helpTriggerRef.current ?? settingsTriggerRef.current;
      target?.focus();
    }, 0);
  }, []);

  const openFormatDocs = useCallback((trigger?: HTMLElement | null) => {
    if (trigger) {
      formatDocsTriggerRef.current = trigger;
    } else if (typeof document !== 'undefined') {
      const active = document.activeElement;
      formatDocsTriggerRef.current =
        active instanceof HTMLElement ? active : settingsTriggerRef.current;
    } else {
      formatDocsTriggerRef.current = settingsTriggerRef.current;
    }
    setFormatDocsOpen(true);
  }, []);

  /* Close the Markdown-format reference dialog (#157, #198) and return
     focus to the control that opened it. Settings still falls back to the
     gear because the drawer closes before this modal appears. */
  /* Open the Markdown-format reference dialog (#157, #198) and remember the
     control that opened it so focus can return there on close. It's reachable
     from the Settings gear (workbench) AND the empty-state hero link, which
     don't coexist — so capture the live opener rather than hard-coding one. */
  /* Close the Markdown-format reference dialog and return focus to whatever
     opened it (the hero link in Phase 1, the Settings gear in Phase 2 — the
     latter as a fallback if the opener was never captured). */
  const closeFormatDocs = useCallback(() => {
    setFormatDocsOpen(false);
    window.setTimeout(() => {
      (formatDocsTriggerRef.current ?? settingsTriggerRef.current)?.focus();
      formatDocsTriggerRef.current = null;
    }, 0);
  }, []);

  /* The mobile Edit/Preview switch (#220). On the stacked layout the editor
     accordion + preview live in one column, so these give a one-tap way to
     jump between them: open/close the accordion (reusing `editorOpen`, the
     single source of truth) and scroll the chosen pane into view. The scroll
     is deferred a frame so the accordion has reflowed first. */
  const showEditor = useCallback(() => {
    setEditorOpen(true);
    requestAnimationFrame(() => {
      editorPaneRef.current?.scrollIntoView({
        behavior: motionOk() ? 'smooth' : 'auto',
        block: 'start',
      });
    });
  }, []);
  const showPreview = useCallback(() => {
    setEditorOpen(false);
    requestAnimationFrame(() => {
      previewRef.current?.scrollIntoView({
        behavior: motionOk() ? 'smooth' : 'auto',
        block: 'start',
      });
    });
  }, []);

  /* Close the print-preview modal (#185) and return focus to the Preview
     button that opened it. Mirrors the other modal-close patterns above. */
  const closePrintPreview = useCallback(() => {
    setPrintPreviewOpen(false);
    window.setTimeout(() => {
      printPreviewTriggerRef.current?.focus();
    }, 0);
  }, []);

  /* ---------------------------------------------------------------- *
   * Resume loaded from the uploader. Track the source filename, then  *
   * scroll the preview into view and announce the load (#53).         *
   *                                                                   *
   * #69: when draft autosave is on AND a non-empty draft was saved    *
   * before this load, announce that the saved copy is being replaced  *
   * rather than the generic "Resume loaded" line. This is decided     *
   * synchronously by reading the source-of-truth from storage so a    *
   * stale React state can't lie about whether a draft existed.        *
   * ---------------------------------------------------------------- */
  const handleResumeLoaded = useCallback((text: string, name: string) => {
    const lines = text.length === 0 ? 0 : text.split('\n').length;
    const linesLabel = `${lines} ${lines === 1 ? 'line' : 'lines'}`;
    // Decide BEFORE we overwrite anything: was a draft on disk?
    const overwritingSavedDraft = isDraftPersistenceEnabled() && (getDraft()?.length ?? 0) > 0;

    setMarkdown(text);
    // Loaded content is the new baseline (#134, #138) — both the
    // modeline `●draft` indicator and the editor tab strip's dirty `●`
    // stay off until the user starts editing.
    setBaselineMarkdown(text);
    setSourceName(name || 'resume.md');

    if (overwritingSavedDraft) {
      // Source-aware, non-alarming. The filename is the closest thing to
      // a "source label" the uploader threads through — fall back to a
      // generic label if it's missing.
      const source = (name && name.trim().length > 0 ? name : 'this file').trim();
      const message = `Saved draft replaced — ${linesLabel} from ${source}.`;
      setLoadAnnouncement(message);
      // Visible counterpart (#77). Bump the id so a second overwrite
      // replaces the first toast instead of stacking.
      toastIdRef.current += 1;
      setToast({ id: toastIdRef.current, message });
    } else {
      setLoadAnnouncement(`Resume loaded — ${linesLabel}.`);
    }
    // Defer the scroll until the preview has rendered.
    window.setTimeout(() => {
      previewRef.current?.scrollIntoView({
        behavior: motionOk() ? 'smooth' : 'auto',
        block: 'start',
      });
    }, 60);
  }, []);

  /**
   * Resume Health → editor jump. The Health panel calls this with a 1-based
   * line number; we drive the editor through its imperative handle (the
   * editor focuses the textarea, selects the line, and scrolls to it).
   *
   * If the Health tab is the one currently rendered in the preview pane, the
   * user might lose the highlight when their eye returns to the editor —
   * which is fine; the editor itself has focus and the selection is visible.
   */
  const handleJumpToLine = useCallback((line: number) => {
    editorHandleRef.current?.jumpToLine(line);
  }, []);

  /**
   * Resume Health → editor jump with a literal offender (#115). Selects the
   * substring on the target line rather than the whole line, so the
   * highlight reads as "this is the bit to change". The editor's handle
   * gracefully falls back to whole-line selection when the offender has
   * been edited away since the finding was computed.
   */
  const handleJumpToOffender = useCallback((line: number, offender: string) => {
    editorHandleRef.current?.jumpToOffender(line, offender);
  }, []);

  /**
   * Resume Health → editor rewrite insertion (#115). Inserts a candidate
   * rewrite as a sibling bullet directly above the original, mirroring the
   * in-editor rewrite tray (#93). The original bullet is never destroyed —
   * the writer can pick the one they prefer and delete the rest.
   *
   * Suggested rewrites are inserted into the editor textarea, never into
   * the preview DOM, so the DOMPurify-sanitized markdown pipeline still
   * owns the trust boundary on its way to the rendered HTML.
   */
  const handleInsertRewrite = useCallback((targetLine: number, rewrittenLine: string) => {
    editorHandleRef.current?.insertRewriteAboveLine(targetLine, rewrittenLine);
  }, []);

  /**
   * Resume Health → "Open an example" affordance (#115, #120).
   *
   * Two paths, picked by whether the writer's resume already carries the
   * requested section:
   *  - PRESENT: jump the editor textarea to the matching H2 so the writer
   *    sees their own pattern (the original #115 behavior).
   *  - ABSENT: open the ExampleDialog (#120) on the bundled sample, which
   *    fetches `public/sample-resume.md`, slices the section, runs it
   *    through `parseResume`, and renders it in a small modal. This avoids
   *    the previous no-op when, say, a Junior resume didn't have a
   *    Selected Impact section.
   *
   * The presence check reads the live `markdown` for H2 headings — same
   * regex shape `editorHandleRef.current?.jumpToSection` uses internally,
   * kept in sync deliberately so the routing decision matches the editor's
   * actual ability to find the section.
   */
  const handleJumpToSection = useCallback(
    (sectionTitle: string) => {
      const want = sectionTitle.toLowerCase().trim();
      const lines = markdown.split('\n');
      let present = false;
      for (const line of lines) {
        const m = /^##\s+(?!#)(.+?)\s*$/.exec(line);
        if (m && m[1].toLowerCase().trim() === want) {
          present = true;
          break;
        }
      }
      if (present) {
        editorHandleRef.current?.jumpToSection(sectionTitle);
        return;
      }
      // Capture the currently-focused element so we can restore focus when
      // the dialog closes — matches the KeyboardHelp UX. activeElement
      // belongs to the Health panel's Open-an-example button by the time
      // this callback fires from a click handler.
      if (typeof document !== 'undefined') {
        const active = document.activeElement;
        exampleTriggerRef.current = active instanceof HTMLElement ? active : null;
      }
      setExampleSection(sectionTitle);
    },
    [markdown],
  );

  /** Close the example dialog and restore focus to its trigger. */
  const closeExampleDialog = useCallback(() => {
    setExampleSection(null);
    // Defer so the dialog has unmounted before we move focus, matching the
    // KeyboardHelp close pattern.
    window.setTimeout(() => {
      exampleTriggerRef.current?.focus();
      exampleTriggerRef.current = null;
    }, 0);
  }, []);

  /* ----- Snapshot handlers (#94). Each is gated on `draftEnabled` via the
     helpers in storage.ts; we also short-circuit here so the in-memory
     list stays consistent if the user races the toggle. */

  /**
   * Build a default snapshot name from `frontmatter.name` + theme + template.
   * The user can edit before confirming — this is just the seed value.
   */
  const suggestedSnapshotName = (() => {
    const personName =
      parsed?.frontmatter && typeof parsed.frontmatter.name === 'string'
        ? parsed.frontmatter.name
        : '';
    const themeLabel = theme?.name ?? 'theme';
    const tail = `${themeLabel} · ${template}`;
    return personName.trim().length > 0 ? `${personName.trim()} — ${tail}` : tail;
  })();

  const handleSaveSnapshot = useCallback(
    (input: { name: string }) => {
      if (!draftEnabled || !theme) return;
      const created = saveSnapshot({
        name: input.name,
        markdown,
        themeSlug: theme.slug,
        template,
      });
      if (!created) return;
      // Re-read so the cap-eviction (oldest dropped on overflow) is reflected.
      setSnapshots(getSnapshots());
      // Saving a snapshot is the closest thing this app has to a "commit" —
      // align the baseline so the modeline's ●draft pill clears (#134).
      setBaselineMarkdown(markdown);
      setLoadAnnouncement(`Snapshot saved: ${created.name}.`);
    },
    [draftEnabled, theme, markdown, template],
  );

  const handleLoadSnapshot = useCallback(
    (snap: ResumeSnapshot) => {
      setMarkdown(snap.markdown);
      // Loading a snapshot resets the baseline — the writer should not see
      // a `●draft` indicator just because they loaded their own save (#134),
      // and the document tab strip's dirty `●` stays off too (#138).
      setBaselineMarkdown(snap.markdown);
      setSourceName(`snapshot · ${snap.name}`);
      // Restore the theme + template the snapshot was captured with, if
      // they still exist in the dataset. A missing theme degrades to the
      // current one — informational, not fatal.
      const restoredTheme = findTheme(snap.themeSlug);
      if (restoredTheme) changeTheme(restoredTheme);
      if (isResumeTemplate(snap.template)) changeTemplate(snap.template);
      setLoadAnnouncement(`Snapshot loaded: ${snap.name}.`);
    },
    [changeTheme, changeTemplate],
  );

  const handleDeleteSnapshot = useCallback(
    (id: string) => {
      if (!draftEnabled) return;
      deleteSnapshot(id);
      setSnapshots(getSnapshots());
    },
    [draftEnabled],
  );

  /** Clear the resume — resets to the empty Phase 1 state. */
  const handleClear = useCallback(() => {
    setMarkdown('');
    setParsed(null);
    // Reset the modeline + tab-strip baseline so neither indicator is
    // carried across a clear (#134, #138) — Phase 1 starts fresh.
    setBaselineMarkdown('');
    setCursorLine(null);
    setCursorColumn(null);
    setSourceName('resume.md');
    setExportOpen(false);
    setThemePickerOpen(false);
    setHelpOpen(false);
    // The preview pane is collapsed in Phase 1, but reset the tab anyway so
    // a fresh upload lands the user on the preview rather than Health.
    setPreviewTab('preview');
    // Clear is destructive by user intent — drop any saved draft too, so
    // a Clear that the user thought was permanent is actually permanent.
    clearDraft();
    setLoadAnnouncement('Resume cleared.');
  }, []);

  /* ---------------------------------------------------------------- *
   * Render. The island shows a tiny placeholder until the theme is    *
   * resolved on mount (one tick) to avoid a flash of an unset theme.  *
   * ---------------------------------------------------------------- */
  if (!theme) {
    return (
      <div className="studio" aria-busy="true">
        <p className="studio__hint">Loading workbench…</p>
      </div>
    );
  }

  return (
    <div className="studio">
      {/* Polite live region — announces resume load / clear (#53). */}
      <p className="visually-hidden" aria-live="polite">
        {loadAnnouncement}
      </p>

      {/* App-chrome light/dark toggle (#192). Rendered unconditionally so
          it's reachable on both the empty state and the loaded workbench;
          floats to the top-right via CSS and is hidden from print. */}
      <ChromeModeToggle />

      {/* ----- Empty-state hero (#127). Rendered ONLY when no resume is
           loaded; once a resume lands, the static AppHeader astro chrome
           returns (the body-level data-app-phase attribute drives the
           swap) and the workbench toolbar below takes over. ----- */}
      {!hasResume && (
        <AppHero
          themeCount={themes.length}
          layoutCount={RESUME_TEMPLATES.length}
          templateCount={STARTER_TEMPLATE_COUNT}
          onOpenFormatDocs={openFormatDocs}
        />
      )}

      {/* ----- Toolbar: theme + export controls. Phase 2 only (#43). -----
           When the ATS preview is active (#98) we tag the toolbar with the
           `--ats-active` modifier. The modifier scales opacity / removes
           hover affordance on the theme-and-layout cluster so the user can
           SEE that those controls are inert in ATS mode without us actually
           disabling them — they can still pre-select a theme to return to
           when they exit ATS. The persistent "Exit ATS preview" pill below
           gives a one-click way out.

           Row structure (#112): the toolbar is intentionally laid out as
           TWO rows on common desktop widths (1280, 1440), with a hard
           row-break element separating them. The wrap class on the toolbar
           still uses `flex-wrap: wrap` so narrow viewports degrade
           gracefully, but the explicit divider keeps the grouping legible:
             Row 1 — theme & layout choice (presets, picker, layout, ATS).
             Row 2 — review aids & save/export (theme nav, page-fit, Save
                     as PDF, Export, Snapshots, shortcuts help). */}
      {hasResume && (
        <div
          className={(() => {
            const classes = ['studio__toolbar'];
            if (previewMode === 'ats') classes.push('studio__toolbar--ats-active');
            if (mobileMoreOpen) classes.push('studio__toolbar--more-open');
            return classes.join(' ');
          })()}
          data-print-hide
          data-mobile-more-open={mobileMoreOpen ? 'true' : 'false'}
          ref={mobileMoreDrawerRef}
        >
          {/* ----- Row 1: theme + layout choice -----
              Wrappers carrying `studio__toolbar-collapsible` are
              `display: contents` on desktop (transparent in flex layout)
              but collapse into the mobile More drawer at < 640px (#131).
              ThemePicker + Save-as-PDF are deliberately NOT wrapped so
              they stay visible on mobile alongside the More trigger. */}
          <div className="studio__toolbar-themable">
            {/* Curated audience presets (#95) were removed in #132 — they
                were redundant with the layout selector (a "Modern" preset
                and a "Modern" layout button) and their active state went
                stale the moment a user changed either bundled coordinate.
                The theme picker's tag chips + WCAG badge are now the path
                to taste-driven first impressions. */}

            {/* ThemePicker — one of two controls that stay visible on
                mobile (#131). Not wrapped in collapsible so the mobile
                CSS leaves it alone. */}
            <ThemePicker
              themes={themes}
              themesLoading={!themesReady}
              current={theme}
              query={themeQuery}
              onQueryChange={setThemeQuery}
              onSelect={changeTheme}
              searchInputId={themeSearchInputId}
              open={themePickerOpen}
              onOpenChange={setThemePickerOpen}
            />

            {/* Hairline separator between THEME and LAYOUT (#135). Wrapped
                in a `studio__toolbar-collapsible` span so the mobile More
                drawer omits it alongside the LayoutSelector itself. */}
            <span className="studio__toolbar-collapsible">
              <span className="studio__toolbar-sep" aria-hidden="true" />
            </span>

            <span className="studio__toolbar-collapsible">
              <LayoutSelector
                templates={RESUME_TEMPLATES}
                current={template}
                onChange={changeTemplate}
              />
            </span>
          </div>

          {previewMode === 'ats' && (
            <button
              type="button"
              className="studio__ats-exit-pill studio__toolbar-collapsible"
              onClick={() => changePreviewMode(false)}
              aria-label="Exit ATS preview"
            >
              <Icon name="close" size={12} />
              Exit ATS preview
            </button>
          )}

          {/* Hard row break (#112, #128). After the #128 consolidation Row 2
              hosts only the review-and-export rhythm: page-fit pill, Save
              as PDF (primary), Export, and a gear icon for the rest. ATS
              toggle, snapshots, shortcut legend, theme prev/next/random,
              and the keyboard help icon all moved into the Settings drawer
              — discoverable via the gear, with keyboard shortcuts (← → r
              / p e ?) still wired here so the drawer is discoverability,
              not the only path. Tagged collapsible so the mobile More
              drawer doesn't carry a phantom row break (#131). */}
          <span
            className="studio__toolbar-rowbreak studio__toolbar-collapsible"
            aria-hidden="true"
          />

          {/* ----- Row 2: review aids + save/export ----- */}

          {/* Page-fit indicator (#92). Reads `.resume-preview` height with
              getBoundingClientRect, divides by US-Letter @ 0.6in content
              height for a quick "Fits 1 page" / "Fit: 1.4 pages" signal.
              Click opens a popover with per-section heights, 2-3 trim
              suggestions, and a checkbox to overlay page-break ruler lines
              on the preview. Sits next to Save-as-PDF so the estimate and
              the export action read as a pair. */}
          <span className="studio__toolbar-collapsible">
            <PageFitIndicator
              previewRef={previewRef}
              layout={template}
              parsed={parsed}
              printMode={printMode}
              onPrintModeChange={setPrintMode}
              bodySizeShift={bodySizeShift}
              onBodySizeShiftChange={setBodySizeShift}
            />
          </span>

          {/* Hairline separator between FIT and the save/export cluster
              (#135). Wrapped in a `studio__toolbar-collapsible` span so
              the mobile More drawer omits it. */}
          <span className="studio__toolbar-collapsible">
            <span className="studio__toolbar-sep" aria-hidden="true" />
          </span>

          {/* Soft spacer that anchors the save/export cluster to the right
              edge of the row, matching the OKLCH reference layout.
              Collapsible so the mobile More drawer doesn't carry a phantom
              horizontal stretch (#131). */}
          <div className="studio__toolbar-spacer studio__toolbar-collapsible" />

          {/* Preview — additive sibling of Save-as-PDF (#185). Opens the
              print-preview modal: a sandboxed iframe loaded from the same
              standalone HTML export the Download HTML affordance writes,
              with the print-mode radio threaded through so the page-fit
              chip's mode dropdown and the modal stay in lockstep. The
              direct Save-as-PDF shortcut below is preserved so power users
              keep their one-click path; Preview is for the writer who
              wants to see what the PDF will look like before committing.

              Wrapped in `studio__toolbar-collapsible` so the mobile More
              drawer (#131) hides it inline and surfaces it inside the
              drawer instead — keeps the closed mobile toolbar under the
              100 px above-the-fold budget. ThemePicker + Save-as-PDF stay
              inline on mobile as the documented exceptions. */}
          <span className="studio__toolbar-collapsible">
            <button
              type="button"
              ref={printPreviewTriggerRef}
              className="btn"
              aria-haspopup="dialog"
              aria-expanded={printPreviewOpen}
              onClick={() => setPrintPreviewOpen(true)}
              disabled={!parsed}
            >
              <Icon name="eye" size={14} />
              Preview
            </button>
          </span>

          {/* Save as PDF — primary toolbar action (#90). A direct,
              single-click path to the most common export. Lives as a peer
              to the Export popover trigger (not inside it) because the
              popover is for the long-tail exports and the radio-toggled
              print modes; Save-as-PDF is the path the toolbar's loudest
              button should ride. Calling window.print() picks up
              document.body.dataset.printMode (set by the existing print
              mode state) so the user's choice of conservative vs theme
              print is honoured. Stays inline on mobile (#131). */}
          <button type="button" className="btn btn--primary" onClick={() => window.print()}>
            <Icon name="file" size={14} />
            Save as PDF
          </button>

          {/* Hairline separator between Save-as-PDF and Export (#135).
              Collapsible so the mobile drawer omits it. */}
          <span className="studio__toolbar-collapsible">
            <span className="studio__toolbar-sep" aria-hidden="true" />
          </span>

          {/* Mobile "More" trigger (#131). `display: none` on desktop —
              the toolbar already shows everything. On viewports < 640px
              CSS reveals it and hides every `studio__toolbar-collapsible`
              child, putting them inside an in-toolbar drawer that flows
              on top of the resume preview when opened. The button is a
              proper `<button aria-haspopup="menu" aria-expanded>` so AT
              users can navigate the same way as the export popover. The
              accessible name is intentionally stable across open/closed
              states — `aria-expanded` carries the toggle signal so the
              user's hook on the button doesn't move under them. */}
          <button
            type="button"
            ref={mobileMoreTriggerRef}
            className="btn studio__toolbar-more-trigger"
            aria-haspopup="menu"
            aria-expanded={mobileMoreOpen}
            aria-label="More toolbar actions"
            onClick={() => setMobileMoreOpen((open) => !open)}
          >
            <span aria-hidden="true">More</span>
            <Icon name={mobileMoreOpen ? 'close' : 'chevron-down'} size={14} />
          </button>

          <div className="export-panel studio__toolbar-collapsible">
            <button
              type="button"
              ref={exportTriggerRef}
              className="btn"
              aria-haspopup="dialog"
              aria-expanded={exportOpen}
              onClick={() => setExportOpen((open) => !open)}
            >
              Export
              <Icon name="chevron-down" size={14} />
            </button>
            {exportOpen && (
              <ExportPanel
                markdown={markdown}
                parsed={parsed}
                theme={theme}
                template={template}
                printMode={printMode}
                onClose={() => setExportOpen(false)}
                triggerRef={exportTriggerRef}
                previewRef={previewRef}
              />
            )}
          </div>

          {/* Hairline separator between Export and the Settings gear
              (#135). Collapsible so the mobile drawer omits it. */}
          <span className="studio__toolbar-collapsible">
            <span className="studio__toolbar-sep" aria-hidden="true" />
          </span>

          {/* ----- Settings drawer trigger (#128) -----
              Rightmost slot of Row 2 on desktop. Opens the modal drawer
              that holds the ATS toggle, draft autosave, clear workspace,
              snapshots, theme nav, and the shortcut legend. On mobile
              (#131) it collapses into the More menu — keyboard shortcuts
              still discover the underlying actions, so a desktop user who
              learned the chord set isn't left without a way in. */}
          <span className="studio__toolbar-collapsible">
            <button
              type="button"
              ref={settingsTriggerRef}
              className="btn btn--icon"
              aria-haspopup="dialog"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              aria-label="Open settings"
            >
              <Icon name="settings" />
            </button>
          </span>
        </div>
      )}

      {/* ----- Split workbench: editor (left) / preview (right) ----- */}
      <div className="studio__split">
        {/* The editor pane is a <details> so on mobile it collapses to a
            one-line summary when a resume is loaded (#100). The `open`
            attribute is set imperatively in a useLayoutEffect — passing
            it via JSX would make React fight the user's native summary
            taps. On the side-by-side desktop layout CSS forces the body
            visible regardless of the `open` state, so the accordion is a
            no-op above 960px.
              - Phase 1 (no resume): open. The uploader IS the experience.
              - Phase 2 (resume loaded): closed while the panes are
                stacked; CSS forces it back open at ≥ 961px so the
                side-by-side desktop layout is unaffected. */}
        <details
          ref={editorPaneRef}
          className="studio__pane studio__pane--editor"
          aria-label="Markdown editor"
          data-print-hide
          open={editorOpen}
          onToggle={(event) => setEditorOpen(event.currentTarget.open)}
        >
          <summary
            className="studio__pane-header studio__pane-header--summary"
            aria-label={`Markdown editor — ${sourceName}`}
          >
            <span className="studio__pane-dots" aria-hidden="true">
              <span className="studio__pane-dot" />
              <span className="studio__pane-dot" />
              <span className="studio__pane-dot" />
            </span>
            {/* The filename pill that used to sit here is now part of the
                editor's document tab strip (#138). On mobile, where the
                accordion is collapsed, we still show the filename in the
                summary as a one-line affordance — the tab strip below is
                hidden by the closed <details>. */}
            <span className="studio__pane-tab studio__pane-tab--mobile-only">{sourceName}</span>
            {/* Mobile-only accordion affordance (#100). Visible below 640px
                when a resume is loaded; CSS hides it on wider viewports
                where the editor pane is always expanded as a peer of the
                preview. */}
            {hasResume && (
              <span className="studio__pane-summary-meta" aria-hidden="true">
                {lineCount} {lineCount === 1 ? 'line' : 'lines'} · edit
              </span>
            )}
          </summary>
          <div className="studio__pane-body">
            <MarkdownUploader
              ref={uploaderHandleRef}
              onLoad={handleResumeLoaded}
              hasResume={hasResume}
              lineCount={lineCount}
              sourceName={sourceName}
              onClear={handleClear}
            />
            {/*
              Opt-in draft persistence (#32).
              Default OFF. Discoverable but unobtrusive — sits beneath the
              uploader row, above the editing surface, with a self-explaining
              hint. Toggling on stores the current Markdown immediately;
              toggling off purges the saved draft from this device.
            */}
            <div className="studio__draft-toggle">
              <label className="studio__draft-toggle-label" htmlFor={draftCheckboxId}>
                <input
                  id={draftCheckboxId}
                  type="checkbox"
                  checked={draftEnabled}
                  onChange={(event) => changeDraftEnabled(event.target.checked)}
                />
                <span>
                  <span className="studio__draft-toggle-name">
                    Remember this resume on this device
                  </span>
                  <span className="studio__draft-toggle-hint">
                    Off by default — saves to local storage only.
                  </span>
                </span>
              </label>
              {/* #176: Collapse the long explanation behind a native <details>.
                  Default closed. The summary is the small "What does that
                  mean?" caption with a chevron; the body holds the full
                  privacy phrasing. <details> gives keyboard + a11y for free. */}
              <details className="studio__draft-toggle-details">
                <summary className="studio__draft-toggle-details-summary">
                  <span>What does that mean?</span>
                  <Icon
                    name="chevron-down"
                    size={12}
                    className="studio__draft-toggle-details-caret"
                  />
                </summary>
                <p className="studio__draft-toggle-details-body">
                  Saves your Markdown to this browser's local storage so it survives a reload. Off
                  by default — nothing is saved unless you turn this on, and turning it off
                  deletes the saved copy immediately.
                </p>
              </details>
            </div>
            <MarkdownEditor
              value={markdown}
              onChange={setMarkdown}
              editorRef={editorHandleRef}
              onCaretChange={handleCaretChange}
              sourceName={sourceName}
              loadedMarkdown={baselineMarkdown}
              onReplaceFile={
                hasResume ? () => uploaderHandleRef.current?.openReplaceDialog() : undefined
              }
              onClear={hasResume ? handleClear : undefined}
            />
            {/* Tailor for a role (#91). Local-only JD keyword overlap.
                Mounted below the editor so it sits alongside the textarea
                the user is editing — the actionable view is "your draft +
                this JD side by side". Gated on a present resume because
                matching against an empty body would be noise. The
                disclosure defaults closed; opening it never persists
                anything. */}
            {hasResume && (
              <TailorForRole
                previewRef={previewRef}
                resumeVersion={parsed}
                previewTab={previewTab}
              />
            )}
          </div>
        </details>

        <section className="studio__pane studio__pane--preview" aria-label="Resume preview">
          <div className="studio__pane-header">
            <span className="studio__pane-dots" aria-hidden="true">
              <span className="studio__pane-dot" />
              <span className="studio__pane-dot" />
              <span className="studio__pane-dot" />
            </span>
            {/* ----- Preview / Health tab toggle (#85) -----
                Real <button> elements with role="tab", aria-selected, and
                aria-controls pointing at the panel they govern. The pair is
                hidden from the printed export via data-print-hide. */}
            <div
              className="studio__pane-tabs"
              role="tablist"
              aria-label="Preview pane"
              data-print-hide
              ref={previewTablistRef}
              onKeyDown={handlePreviewTabsKeyDown}
            >
              <button
                type="button"
                id={previewTabId}
                role="tab"
                aria-selected={previewTab === 'preview'}
                aria-controls={previewPanelId}
                tabIndex={previewTab === 'preview' ? 0 : -1}
                className={
                  previewTab === 'preview'
                    ? 'studio__pane-tab studio__pane-tab--active'
                    : 'studio__pane-tab'
                }
                onClick={() => setPreviewTab('preview')}
              >
                Preview
              </button>
              <button
                type="button"
                id={healthTabId}
                role="tab"
                aria-selected={previewTab === 'health'}
                aria-controls={healthPanelId}
                tabIndex={previewTab === 'health' ? 0 : -1}
                className={
                  previewTab === 'health'
                    ? 'studio__pane-tab studio__pane-tab--active'
                    : 'studio__pane-tab'
                }
                onClick={() => setPreviewTab('health')}
              >
                Health
              </button>
            </div>

            {/* Theme name + WCAG badge (#88, #130). The badge reports a
                single tiered pill (`AAA · 13.4:1`) on the WORST of the two
                conformance signals — body text on background, and accent
                on background. The glyph + literal still carry the level so
                colour is never the sole channel. Shown only on the Preview
                tab — the Health tab has its own score banner and the theme
                is irrelevant there. */}
            {previewTab === 'preview' && (
              <span className="studio__pane-meta">
                <span className="studio__pane-theme-name">{theme.name}</span>
                <WcagBadge
                  fgRatio={theme.contrast.fgOnBg}
                  accentRatio={theme.contrast.accentOnBg}
                />
              </span>
            )}
          </div>
          {previewTab === 'preview' ? (
            <div
              className="studio__pane-body"
              ref={previewRef}
              id={previewPanelId}
              role="tabpanel"
              aria-labelledby={previewTabId}
            >
              <ResumePreview
                parsed={parsed}
                template={template}
                mode={previewMode}
                onLoadSample={handleResumeLoaded}
              />
            </div>
          ) : (
            <div
              className="studio__pane-body studio__pane-body--health"
              id={healthPanelId}
              role="tabpanel"
              aria-labelledby={healthTabId}
              data-print-hide
            >
              <ResumeHealth
                markdown={markdown}
                parsed={parsed}
                onJumpToLine={handleJumpToLine}
                onJumpToOffender={handleJumpToOffender}
                onInsertRewrite={handleInsertRewrite}
                onJumpToSection={handleJumpToSection}
              />
            </div>
          )}
        </section>
      </div>

      {/* ----- Status line (#134) -----
           Vim-modeline-style readout pinned to the bottom of the studio
           container. Consolidates the scattered state signals (filename,
           line count, cursor, Health score, Fit, dirty marker, WCAG)
           into a single mono strip. Hidden in Phase 1 — without a resume
           the modeline would be a row of dashes. Hidden on print via
           data-print-hide (set inside the component). */}
      {hasResume && (
        <StudioStatusLine
          markdown={markdown}
          parsed={parsed}
          sourceName={sourceName}
          cursorLine={cursorLine}
          cursorColumn={cursorColumn}
          dirty={markdown !== baselineMarkdown}
          previewRef={previewRef}
          wcag={theme.contrast}
        />
      )}

      {/* ----- Mobile Edit/Preview switch (#220) -----
           A sticky, thumb-reachable one-tap toggle between the editor and
           the preview. Only meaningful while the panes are stacked, so CSS
           hides it on the side-by-side desktop layout (≥961px). Reuses
           `editorOpen` — it's a view toggle (aria-pressed), not a tablist.
           Hidden from print via data-print-hide. */}
      {hasResume && (
        <div className="studio__view-switch" role="group" aria-label="Editor and preview" data-print-hide>
          <button
            type="button"
            className="studio__view-switch-btn"
            aria-pressed={editorOpen}
            onClick={showEditor}
          >
            Edit
          </button>
          <button
            type="button"
            className="studio__view-switch-btn"
            aria-pressed={!editorOpen}
            onClick={showPreview}
          >
            Preview
          </button>
        </div>
      )}

      {/* ----- Keyboard-shortcuts help overlay (#58). ----- */}
      {helpOpen && (
        <KeyboardHelp
          shortcutsEnabled={shortcutsEnabled}
          onShortcutsEnabledChange={changeShortcutsEnabled}
          onClose={closeHelp}
        />
      )}

      {/* ----- Settings drawer (#128). Right-anchored modal that hosts the
           low-frequency controls that used to live across four toolbar
           islands (ATS toggle, snapshots, shortcuts chip, keyboard-help
           icon). Mounted only when open. ----- */}
      {settingsOpen && (
        <SettingsDrawer
          onClose={closeSettings}
          atsActive={previewMode === 'ats'}
          onAtsChange={changePreviewMode}
          draftEnabled={draftEnabled}
          onDraftEnabledChange={changeDraftEnabled}
          onClearWorkspace={handleClear}
          snapshots={snapshots}
          suggestedSnapshotName={suggestedSnapshotName}
          onSaveSnapshot={handleSaveSnapshot}
          onLoadSnapshot={handleLoadSnapshot}
          onDeleteSnapshot={handleDeleteSnapshot}
          shortcutsEnabled={shortcutsEnabled}
          onOpenKeyboardHelp={() => setHelpOpen(true)}
          onOpenFormatDocs={openFormatDocs}
          onPreviousTheme={() => stepTheme(-1)}
          onNextTheme={() => stepTheme(1)}
          onRandomTheme={randomTheme}
        />
      )}

      {/* ----- Markdown format reference dialog (#157) -----
           Opens from the Settings drawer's Help group. Mounted only when
           open; the drawer closes itself first so this lands on a clean
           stage. Close affordances (Esc, click outside, explicit button)
           all route through `closeFormatDocs`, which restores focus to
           the Settings gear. ----- */}
      {formatDocsOpen && <FormatDocsDialog onClose={closeFormatDocs} />}

      {/* ----- Print preview modal (#185) -----
           Opens from the toolbar Preview button next to Save-as-PDF. The
           modal embeds the standalone HTML export in a sandboxed iframe so
           the writer sees the exact document the Save-as-PDF path would
           produce, with the print-mode radio threaded through so toggling
           between Conservative and Themed updates both the iframe and the
           page-fit chip's mode dropdown. Mounted only when a resume is
           loaded and the dialog is open. */}
      {printPreviewOpen && parsed && (
        <PrintPreviewDialog
          parsed={parsed}
          theme={theme}
          template={template}
          printMode={printMode}
          onPrintModeChange={setPrintMode}
          onClose={closePrintPreview}
        />
      )}

      {/* ----- Resume Health → Open-an-example dialog (#120) -----
           Mounted only when the Health panel asks for an example AND the
           writer's resume doesn't already have that section. Shows the
           bundled sample's section, sanitized through the same parseResume
           pipeline a real upload uses. Close affordances: Esc, click
           outside, explicit close button — all routed through
           `closeExampleDialog`, which also restores focus to the trigger. */}
      {exampleSection !== null && (
        <ExampleDialog sectionTitle={exampleSection} onClose={closeExampleDialog} />
      )}

      {/* ----- Overwrite toast (#77). Visual companion to the aria-live
           announcement above; the toast intentionally has no live-region
           semantics so AT users don't hear the message twice. ----- */}
      {toast && <Toast id={toast.id} message={toast.message} onDismiss={dismissToast} />}
    </div>
  );
}

/** True when the OS currently prefers a dark color scheme. */
function matchesDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/**
 * Single WCAG conformance pill for the preview pane header (#88, #130).
 *
 * #130 collapses the previous two-chip arrangement (body-text + accent
 * ratios) into ONE pill that surfaces the WORST of the two pairs. This
 * matches the OKLCH terminal-themes reference and gives the reviewer a
 * single legibility number to scan instead of two competing chips.
 *
 * The badge carries text + a glyph so the level is never conveyed by
 * colour alone:
 *  - AAA → check glyph + green tint
 *  - AA  → 'AA' literal + amber tint
 *  - fails AA → ⚠ + red tint
 *
 * The accessible label spells out BOTH ratios so users who care about the
 * per-pair breakdown can still hear them — the visual pill stays single
 * for the OKLCH-inspired silhouette.
 *
 * `className` adds the `--worst-accent` modifier when the binding constraint
 * is the accent (not the body text), so the CSS could surface the pair
 * source in a follow-up — today it's purely an information-architecture hook.
 */
function WcagBadge({ fgRatio, accentRatio }: { fgRatio: number; accentRatio: number }) {
  // The pill represents the WORST of the two pairs — that's the constraint
  // a reviewer should know about. Accent rarely beats body text on
  // luminance-balanced themes, but a low-accent theme can fail AA while the
  // body still reads AAA; the user needs to see that.
  const worst = Math.min(fgRatio, accentRatio);
  const isAccentWorse = accentRatio < fgRatio;
  const level = wcagLevel(worst);
  const baseClass =
    level === 'AAA'
      ? 'studio__pane-wcag studio__pane-wcag--aaa'
      : level === 'AA'
        ? 'studio__pane-wcag studio__pane-wcag--aa'
        : 'studio__pane-wcag studio__pane-wcag--fail';
  const className = isAccentWorse ? `${baseClass} studio__pane-wcag--worst-accent` : baseClass;
  // Glyph + literal carry the meaning; the colour is reinforcement only.
  const glyph = level === 'AAA' ? '✓' : level === 'AA' ? 'AA' : '⚠';
  // Full sentence for AT — surfaces BOTH ratios so a screen-reader user
  // still has the per-pair breakdown the visual pill collapses.
  const source = isAccentWorse ? 'accent' : 'body text';
  const label =
    `WCAG ${level} — worst contrast ${worst.toFixed(1)}:1 (${source}). ` +
    `Body text: ${fgRatio.toFixed(1)}:1. Accent: ${accentRatio.toFixed(1)}:1.`;
  return (
    <span className={className} title={label} aria-label={label} role="img">
      <span className="studio__pane-wcag-glyph" aria-hidden="true">
        {glyph}
      </span>
      <span className="studio__pane-wcag-text">
        {level === 'fails AA' ? 'fails' : level} · {worst.toFixed(1)}:1
      </span>
    </span>
  );
}

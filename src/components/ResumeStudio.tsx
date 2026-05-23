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
import { useCallback, useEffect, useId, useRef, useState } from 'react';
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
  getDraft,
  getStoredTemplate,
  isDraftPersistenceEnabled,
  setDraft,
  setDraftPersistenceEnabled,
  setStoredTemplate,
  setStoredThemeSlug,
} from '../utils/storage';
import MarkdownUploader from './MarkdownUploader';
import MarkdownEditor from './MarkdownEditor';
import ResumePreview from './ResumePreview';
import ThemePicker from './ThemePicker';
import ThemeControls from './ThemeControls';
import LayoutSelector from './LayoutSelector';
import AtsModeToggle from './AtsModeToggle';
import ExportPanel from './ExportPanel';
import KeyboardHelp, { getStoredShortcutsEnabled, setStoredShortcutsEnabled } from './KeyboardHelp';
import Icon from './Icon';
import Toast from './Toast';

/** sessionStorage key for the ATS preview mode (#31). */
const ATS_MODE_SESSION_KEY = 'womr:ats-mode';

/** Debounce window for re-parsing Markdown as the user types. */
const PARSE_DEBOUNCE_MS = 200;

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

  /* ----- Theme state -----
     The ~600 kB theme dataset is code-split (#78): it loads asynchronously
     via a dynamic import on mount. `themes` starts with whatever
     `getAllThemes()` returns synchronously (just `HARDCODED_FALLBACK` until
     the dataset is here) and is replaced with the full ~545 entries once
     `loadAllThemesAsync()` resolves. `themesReady` toggles when the load
     finishes — the picker reads it to show a brief loading state. */
  const [themes, setThemes] = useState<ResumeTheme[]>(() => getAllThemes());
  const [themesReady, setThemesReady] = useState<boolean>(() => themesLoaded());
  const [theme, setTheme] = useState<ResumeTheme | null>(null);
  const [themeQuery, setThemeQuery] = useState('');
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [resumeSafeOnly, setResumeSafeOnly] = useState(false);

  /* ----- UI state ----- */
  const [exportOpen, setExportOpen] = useState(false);
  const [printMode, setPrintMode] = useState<PrintMode>('conservative');
  const [loadAnnouncement, setLoadAnnouncement] = useState('');

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

  const themeSearchInputId = useId();
  const draftCheckboxId = useId();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const helpTriggerRef = useRef<HTMLButtonElement>(null);

  /** A resume is present once Markdown has been entered. */
  const hasResume = markdown.trim() !== '';
  const lineCount = markdown.length === 0 ? 0 : markdown.split('\n').length;

  /* ---------------------------------------------------------------- *
   * Mount: resolve and apply the initial theme, then async-load the   *
   * full theme dataset (#78). Two-stage so first paint is never       *
   * blocked on the ~600 kB JSON chunk:                                *
   *                                                                   *
   *   1. Sync: resolve from URL/storage/curated and apply             *
   *      `HARDCODED_FALLBACK` (the only theme available before the    *
   *      dataset loads). For a URL or stored slug we hold the slug    *
   *      and reapply post-load — `findTheme` returns undefined for    *
   *      now since the cache is empty.                                *
   *   2. Async: dynamic-import the dataset, hand the full list to     *
   *      state, and re-resolve the active theme so a `?theme=foo`     *
   *      URL ends up displaying `foo` rather than the boot fallback.  *
   * ---------------------------------------------------------------- */
  useEffect(() => {
    const slug = resolveInitialThemeSlug();
    const initial = findTheme(slug) ?? getFallbackTheme(matchesDark());
    setTheme(initial);
    applyThemeToDocument(initial);

    // Kick off the lazy load. If it has already happened (HMR, fast nav)
    // `loadAllThemesAsync` returns the cached array immediately.
    let cancelled = false;
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
      })
      .catch(() => {
        // Network / chunk-load failure: keep the boot fallback. The picker
        // remains usable on just the fallback theme — degraded but legible.
      });
    return () => {
      cancelled = true;
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
        setSourceName('saved-draft.md');
        setLoadAnnouncement('Restored your saved draft.');
      }
    }
    setDraftRestored(true);
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
        setLoadAnnouncement('Draft saving is on for this device.');
      } else {
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

  /* ----- Theme navigation helpers ----- */
  const stepTheme = useCallback(
    (delta: number) => {
      if (!theme || themes.length === 0) return;
      const index = themes.findIndex((t) => t.slug === theme.slug);
      const base = index === -1 ? 0 : index;
      const nextIndex = (base + delta + themes.length) % themes.length;
      const next = themes[nextIndex];
      if (next) changeTheme(next);
    },
    [theme, themes, changeTheme],
  );

  const randomTheme = useCallback(() => {
    if (themes.length === 0) return;
    let pick = themes[Math.floor(Math.random() * themes.length)];
    // Avoid picking the current theme when there's a choice.
    if (themes.length > 1 && theme && pick.slug === theme.slug) {
      pick = themes[(themes.indexOf(pick) + 1) % themes.length];
    }
    if (pick) changeTheme(pick);
  }, [themes, theme, changeTheme]);

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
        if (isEditableTarget(event.target)) {
          (event.target as HTMLElement).blur();
        }
        return;
      }

      // The help overlay traps focus and handles its own keys.
      if (helpOpen) return;

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
  }, [exportOpen, themePickerOpen, helpOpen, hasResume, shortcutsEnabled, stepTheme, randomTheme]);

  /* On close of the help overlay, restore focus to whatever opened it. */
  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    // Defer so the dialog has unmounted before we move focus.
    window.setTimeout(() => helpTriggerRef.current?.focus(), 0);
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

  /** Clear the resume — resets to the empty Phase 1 state. */
  const handleClear = useCallback(() => {
    setMarkdown('');
    setParsed(null);
    setSourceName('resume.md');
    setExportOpen(false);
    setThemePickerOpen(false);
    setHelpOpen(false);
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

      {/* ----- Toolbar: theme + export controls. Phase 2 only (#43). ----- */}
      {hasResume && (
        <div className="studio__toolbar" data-print-hide>
          <ThemePicker
            themes={themes}
            themesLoading={!themesReady}
            current={theme}
            query={themeQuery}
            onQueryChange={setThemeQuery}
            resumeSafeOnly={resumeSafeOnly}
            onResumeSafeOnlyChange={setResumeSafeOnly}
            onSelect={changeTheme}
            searchInputId={themeSearchInputId}
            open={themePickerOpen}
            onOpenChange={setThemePickerOpen}
          />

          <LayoutSelector
            templates={RESUME_TEMPLATES}
            current={template}
            onChange={changeTemplate}
          />

          <AtsModeToggle active={previewMode === 'ats'} onChange={changePreviewMode} />

          <div className="studio__toolbar-spacer" />

          <ThemeControls
            current={theme}
            onPrevious={() => stepTheme(-1)}
            onNext={() => stepTheme(1)}
            onRandom={randomTheme}
          />

          <div className="export-panel">
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
                onPrintModeChange={setPrintMode}
                onClose={() => setExportOpen(false)}
                triggerRef={exportTriggerRef}
              />
            )}
          </div>

          <button
            type="button"
            ref={helpTriggerRef}
            className="btn btn--icon"
            aria-haspopup="dialog"
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen(true)}
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
          >
            <Icon name="help" />
          </button>
        </div>
      )}

      {/* ----- Keyboard shortcut legend. Phase 2 only (#43). -----
           Intentionally NOT aria-hidden: it is genuine, useful content for
           screen-reader users. The trailing button opens the full help
           dialog and is the discoverable affordance for the `?` shortcut. */}
      {hasResume && (
        <div className="studio__shortcuts" data-print-hide>
          <span className="studio__shortcuts-label">Shortcuts</span>
          {shortcutsEnabled ? (
            <>
              <span>
                <kbd>←</kbd> <kbd>→</kbd> theme
              </span>
              <span>
                <kbd>r</kbd> random
              </span>
              <span>
                <kbd>/</kbd> search themes
              </span>
              <span>
                <kbd>p</kbd> print
              </span>
              <span>
                <kbd>e</kbd> export
              </span>
              <span>
                <kbd>Esc</kbd> close
              </span>
            </>
          ) : (
            <span className="studio__shortcuts-off">
              Single-key shortcuts are off — <kbd>Esc</kbd> still closes panels.
            </span>
          )}
          <button
            type="button"
            className="studio__shortcuts-help"
            onClick={() => setHelpOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={helpOpen}
          >
            <Icon name="help" size={13} />
            {shortcutsEnabled ? 'All shortcuts' : 'Shortcut settings'}
          </button>
        </div>
      )}

      {/* ----- Split workbench: editor (left) / preview (right) ----- */}
      <div className="studio__split">
        <section
          className="studio__pane studio__pane--editor"
          aria-label="Markdown editor"
          data-print-hide
        >
          <div className="studio__pane-header">
            <span className="studio__pane-dots" aria-hidden="true">
              <span className="studio__pane-dot" />
              <span className="studio__pane-dot" />
              <span className="studio__pane-dot" />
            </span>
            <span className="studio__pane-tab">{sourceName}</span>
          </div>
          <div className="studio__pane-body">
            <MarkdownUploader
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
                    Saves your Markdown to this browser's local storage so it survives a reload. Off
                    by default — nothing is saved unless you turn this on, and turning it off
                    deletes the saved copy immediately.
                  </span>
                </span>
              </label>
            </div>
            <MarkdownEditor value={markdown} onChange={setMarkdown} />
          </div>
        </section>

        <section className="studio__pane studio__pane--preview" aria-label="Resume preview">
          <div className="studio__pane-header">
            <span className="studio__pane-dots" aria-hidden="true">
              <span className="studio__pane-dot" />
              <span className="studio__pane-dot" />
              <span className="studio__pane-dot" />
            </span>
            <span className="studio__pane-tab">preview · {theme.name}</span>
          </div>
          <div className="studio__pane-body" ref={previewRef}>
            <ResumePreview parsed={parsed} template={template} mode={previewMode} />
          </div>
        </section>
      </div>

      {/* ----- Keyboard-shortcuts help overlay (#58). ----- */}
      {helpOpen && (
        <KeyboardHelp
          shortcutsEnabled={shortcutsEnabled}
          onShortcutsEnabledChange={changeShortcutsEnabled}
          onClose={closeHelp}
        />
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

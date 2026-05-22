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
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ParsedResume, PrintMode, ResumeTheme } from '../types';
import { parseResume } from '../utils/markdown';
import {
  applyThemeToDocument,
  findTheme,
  getAllThemes,
  getFallbackTheme,
  resolveInitialThemeSlug,
} from '../utils/themes';
import { setStoredThemeSlug } from '../utils/storage';
import MarkdownUploader from './MarkdownUploader';
import MarkdownEditor from './MarkdownEditor';
import ResumePreview from './ResumePreview';
import ThemePicker from './ThemePicker';
import ThemeControls from './ThemeControls';
import ExportPanel from './ExportPanel';
import Icon from './Icon';

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

  /* ----- Theme state ----- */
  const themes = useMemo<ResumeTheme[]>(() => getAllThemes(), []);
  const [theme, setTheme] = useState<ResumeTheme | null>(null);
  const [themeQuery, setThemeQuery] = useState('');
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [resumeSafeOnly, setResumeSafeOnly] = useState(false);

  /* ----- UI state ----- */
  const [exportOpen, setExportOpen] = useState(false);
  const [printMode, setPrintMode] = useState<PrintMode>('conservative');
  const [loadAnnouncement, setLoadAnnouncement] = useState('');

  const themeSearchInputId = useId();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);

  /** A resume is present once Markdown has been entered. */
  const hasResume = markdown.trim() !== '';
  const lineCount = markdown.length === 0 ? 0 : markdown.split('\n').length;

  /* ---------------------------------------------------------------- *
   * Mount: resolve and apply the initial theme.                       *
   * ---------------------------------------------------------------- */
  useEffect(() => {
    const slug = resolveInitialThemeSlug();
    const initial = findTheme(slug) ?? getFallbackTheme(matchesDark());
    setTheme(initial);
    applyThemeToDocument(initial);
  }, []);

  /* ---------------------------------------------------------------- *
   * Reflect print mode onto <body> so print.css can react.            *
   * ---------------------------------------------------------------- */
  useEffect(() => {
    document.body.dataset.printMode = printMode;
  }, [printMode]);

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
   * Escape always works. The resume-acting shortcuts (theme nav, /,   *
   * print, export) are gated on a resume being present — they have no *
   * meaning in the empty Phase 1 state.                               *
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

      // Never hijack typing, and never fight browser/OS chords.
      if (isEditableTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

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
        default:
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [exportOpen, themePickerOpen, hasResume, stepTheme, randomTheme]);

  /* ---------------------------------------------------------------- *
   * Resume loaded from the uploader. Track the source filename, then  *
   * scroll the preview into view and announce the load (#53).         *
   * ---------------------------------------------------------------- */
  const handleResumeLoaded = useCallback((text: string, name: string) => {
    setMarkdown(text);
    setSourceName(name || 'resume.md');
    const lines = text.length === 0 ? 0 : text.split('\n').length;
    setLoadAnnouncement(`Resume loaded — ${lines} ${lines === 1 ? 'line' : 'lines'}.`);
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
                printMode={printMode}
                onPrintModeChange={setPrintMode}
                onClose={() => setExportOpen(false)}
                triggerRef={exportTriggerRef}
              />
            )}
          </div>
        </div>
      )}

      {/* ----- Keyboard shortcut legend. Phase 2 only (#43). ----- */}
      {hasResume && (
        <div className="studio__shortcuts" data-print-hide>
          <span className="studio__shortcuts-label">Shortcuts</span>
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
            <ResumePreview parsed={parsed} />
          </div>
        </section>
      </div>
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

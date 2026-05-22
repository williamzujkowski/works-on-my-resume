/**
 * ResumeStudio — the React island root and single source of app state.
 *
 * Owns: the Markdown source string, the derived `ParsedResume` (recomputed
 * via `parseResume`, debounced on edits), the themes array, the current
 * theme, the theme search query, the resume-safe-only toggle, the
 * export-panel-open flag, and the print mode.
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

/** Debounce window for re-parsing Markdown as the user types. */
const PARSE_DEBOUNCE_MS = 200;

/** Tags whose keystrokes must NOT trigger app shortcuts. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export default function ResumeStudio() {
  /* ----- Resume content state (in-memory only, never persisted) ----- */
  const [markdown, setMarkdown] = useState('');
  const [parsed, setParsed] = useState<ParsedResume | null>(null);

  /* ----- Theme state ----- */
  const themes = useMemo<ResumeTheme[]>(() => getAllThemes(), []);
  const [theme, setTheme] = useState<ResumeTheme | null>(null);
  const [previewTheme, setPreviewTheme] = useState<ResumeTheme | null>(null);
  const [themeQuery, setThemeQuery] = useState('');
  const [resumeSafeOnly, setResumeSafeOnly] = useState(false);

  /* ----- UI state ----- */
  const [exportOpen, setExportOpen] = useState(false);
  const [printMode, setPrintMode] = useState<PrintMode>('conservative');

  const themeSearchInputId = useId();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
   * Apply preview theme or current theme to document.                 *
   * ---------------------------------------------------------------- */
  useEffect(() => {
    if (theme) {
      applyThemeToDocument(previewTheme ?? theme);
    }
  }, [previewTheme, theme]);

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
   * ---------------------------------------------------------------- */
  const changeTheme = useCallback((next: ResumeTheme) => {
    setTheme(next);
    applyThemeToDocument(next);
    setStoredThemeSlug(next.slug);
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

  const focusThemeSearch = useCallback(() => {
    const input = document.getElementById(themeSearchInputId);
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  }, [themeSearchInputId]);

  /* ---------------------------------------------------------------- *
   * Global keyboard shortcuts.                                        *
   * Shortcuts (except Escape) are ignored when typing in a field.     *
   * ---------------------------------------------------------------- */
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Escape always works: close panels, blur the active field.
      if (event.key === 'Escape') {
        if (exportOpen) {
          setExportOpen(false);
        }
        if (isEditableTarget(event.target)) {
          (event.target as HTMLElement).blur();
        }
        return;
      }

      // Never hijack typing, and never fight browser/OS chords.
      if (isEditableTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

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
          focusThemeSearch();
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
  }, [exportOpen, stepTheme, randomTheme, focusThemeSearch]);

  /* ----- Resume loaded from the uploader ----- */
  const handleResumeLoaded = useCallback((text: string) => {
    setMarkdown(text);
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
      {/* ----- Toolbar: theme + export controls ----- */}
      <div className="studio__toolbar" data-print-hide>
        <ThemePicker
          themes={themes}
          current={theme}
          query={themeQuery}
          onQueryChange={setThemeQuery}
          resumeSafeOnly={resumeSafeOnly}
          onResumeSafeOnlyChange={setResumeSafeOnly}
          onSelect={changeTheme}
          onPreview={setPreviewTheme}
          searchInputId={themeSearchInputId}
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
            className="btn"
            aria-haspopup="dialog"
            aria-expanded={exportOpen}
            onClick={() => setExportOpen((open) => !open)}
          >
            Export ▾
          </button>
          {exportOpen && (
            <ExportPanel
              markdown={markdown}
              parsed={parsed}
              theme={theme}
              printMode={printMode}
              onPrintModeChange={setPrintMode}
              onClose={() => setExportOpen(false)}
            />
          )}
        </div>
      </div>

      {/* ----- Keyboard shortcut legend ----- */}
      <div className="studio__shortcuts" data-print-hide aria-hidden="true">
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

      {/* ----- Split workbench: editor (left) / preview (right) ----- */}
      <div className="studio__split">
        <section
          className="studio__pane studio__pane--editor"
          aria-label="Markdown editor"
          data-print-hide
        >
          <div className="studio__pane-header">
            <span className="studio__pane-dot" aria-hidden="true" />
            <span>edit · resume.md</span>
          </div>
          <div className="studio__pane-body">
            <MarkdownUploader onLoad={handleResumeLoaded} />
            <div style={{ height: 'var(--space-3)' }} />
            <MarkdownEditor value={markdown} onChange={setMarkdown} />
          </div>
        </section>

        <section className="studio__pane studio__pane--preview" aria-label="Resume preview">
          <div className="studio__pane-header">
            <span className="studio__pane-dot" aria-hidden="true" />
            <span>preview · {theme.name}</span>
          </div>
          <div className="studio__pane-body">
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

/**
 * ExportPanel — print / download options.
 *
 * Toggled by the `e` shortcut or its toolbar button. Offers:
 *   - Print / Save as PDF (window.print()).
 *   - A print-mode toggle: Conservative (default) vs. Current theme.
 *   - Download Markdown / HTML / theme CSS, wired to src/utils/export.ts.
 *
 * All exports are local file downloads — nothing is transmitted.
 *
 * Focus management (#57): the panel is genuinely NON-MODAL — `aria-modal` is
 * false to match. On open it focuses the first *actionable* control (the
 * first print-mode radio, not the Close button). It dismisses on Escape and
 * on outside-click, and on close it restores focus to the Export trigger.
 */
import { useEffect, useId, useRef } from 'react';
import type { ParsedResume, PrintMode, ResumeTemplate, ResumeTheme } from '../types';
import { DEFAULT_RESUME_TEMPLATE } from '../types';
import {
  downloadMarkdown,
  downloadPlainText,
  downloadResumeHtml,
  downloadResumeZip,
  downloadThemeCss,
} from '../utils/export';
import { downloadJsonResume, toJsonResume } from '../utils/jsonresume';
import Icon from './Icon';

interface ExportPanelProps {
  /** The resume Markdown source (for Download Markdown). */
  markdown: string;
  /** Parsed resume, or null when nothing is loaded. */
  parsed: ParsedResume | null;
  /** The active theme. */
  theme: ResumeTheme;
  /**
   * The active layout template (#30). Applied to the standalone HTML export
   * and the ZIP bundle so a download faithfully reflects the in-app preview.
   */
  template?: ResumeTemplate;
  /** Current print mode. */
  printMode: PrintMode;
  onPrintModeChange: (mode: PrintMode) => void;
  /** Request the panel be closed. */
  onClose: () => void;
  /** The trigger button that opened the panel — focus returns here on close. */
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  /**
   * Live ref to the preview pane wrapper — the plain-text export (#110)
   * walks the rendered `.resume-preview` article inside it to produce its
   * output, so the file mirrors exactly what the user sees on screen.
   */
  previewRef: React.RefObject<HTMLElement | null>;
}

export default function ExportPanel({
  markdown,
  parsed,
  theme,
  template = DEFAULT_RESUME_TEMPLATE,
  printMode,
  onPrintModeChange,
  onClose,
  triggerRef,
  previewRef,
}: ExportPanelProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstControlRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const hasResume = parsed !== null;

  /* On open: focus the first actionable control (not the Close button). */
  useEffect(() => {
    firstControlRef.current?.focus();
  }, []);

  /* On close: restore focus to the trigger that opened the panel. */
  useEffect(() => {
    const trigger = triggerRef.current;
    return () => {
      trigger?.focus();
    };
  }, [triggerRef]);

  /* Non-modal dismissal: close on a pointer-down outside the panel and its
     trigger. Escape is handled on the dialog's own keydown. */
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (dialogRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [onClose, triggerRef]);

  return (
    <div
      ref={dialogRef}
      className="export-panel__dialog"
      role="dialog"
      aria-modal="false"
      aria-labelledby={headingId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="export-panel__header">
        <h2 id={headingId} className="export-panel__title">
          Export
        </h2>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={onClose}
          aria-label="Close export panel"
        >
          <Icon name="close" />
        </button>
      </div>

      <div className="export-panel__group">
        <span className="export-panel__group-label">Print / PDF</span>
        <fieldset className="export-panel__radio-group">
          <legend className="visually-hidden">Print mode</legend>
          <label className="export-panel__radio">
            <input
              ref={firstControlRef}
              type="radio"
              name="print-mode"
              checked={printMode === 'conservative'}
              onChange={() => onPrintModeChange('conservative')}
            />
            <span>
              Conservative
              <span className="export-panel__radio-hint">
                White paper, black ink — ATS- and printer-friendly.
              </span>
            </span>
          </label>
          <label className="export-panel__radio">
            <input
              type="radio"
              name="print-mode"
              checked={printMode === 'theme'}
              onChange={() => onPrintModeChange('theme')}
            />
            <span>
              Current theme
              <span className="export-panel__radio-hint">
                Print using the “{theme.name}” colors.
              </span>
            </span>
          </label>
        </fieldset>
        <div className="export-panel__buttons">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => window.print()}
            disabled={!hasResume}
          >
            Print / Save as PDF
          </button>
        </div>
      </div>

      <div className="export-panel__group">
        <span className="export-panel__group-label">Download</span>
        <div className="export-panel__buttons">
          <button
            type="button"
            className="btn"
            disabled={!hasResume}
            onClick={() => {
              if (parsed) downloadMarkdown(markdown, parsed.frontmatter);
            }}
          >
            Download Markdown (.md)
          </button>
          <button
            type="button"
            className="btn"
            disabled={!hasResume}
            onClick={() => {
              if (!parsed) return;
              /* Walk the live preview's `.resume-preview` article. The
                 preview ref points at the pane wrapper; the article is
                 mounted inside it whenever the Preview tab is active.
                 If the wrapper is not mounted (e.g. user on the Health
                 tab when they hit the shortcut), fall back to a no-op
                 to avoid a silent malformed download. */
              const article =
                previewRef.current?.querySelector<HTMLElement>('.resume-preview') ?? null;
              if (!article) return;
              downloadPlainText(article, parsed.frontmatter);
            }}
          >
            Download plain text (.txt)
          </button>
          <button
            type="button"
            className="btn"
            disabled={!hasResume}
            onClick={() => {
              if (parsed) {
                downloadResumeHtml(parsed.html, theme, parsed.frontmatter, template, printMode);
              }
            }}
          >
            Download HTML (.html)
          </button>
          <button
            type="button"
            className="btn"
            disabled={!hasResume}
            onClick={() => {
              if (parsed) downloadJsonResume(toJsonResume(parsed, markdown));
            }}
          >
            Download JSON Resume (.json)
          </button>
          <button type="button" className="btn" onClick={() => downloadThemeCss(theme)}>
            Download theme CSS (.css)
          </button>
          <button
            type="button"
            className="btn"
            disabled={!hasResume}
            onClick={() => {
              if (parsed) {
                downloadResumeZip(
                  markdown,
                  parsed.html,
                  theme,
                  parsed.frontmatter,
                  template,
                  printMode,
                );
              }
            }}
          >
            Download as .zip
          </button>
        </div>
        <p className="export-panel__note">
          Downloads are generated in your browser. Nothing is uploaded. The .zip bundles the
          Markdown, the standalone HTML, and the theme CSS.
        </p>
      </div>
    </div>
  );
}

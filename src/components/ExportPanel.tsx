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
 *
 * Grouping (#136): the seven download buttons used to read as a flat list
 * of identical-tone rows. They're now grouped under three kicker-headed
 * sections — DOCUMENT (PDF / MD / HTM), DATA (TXT / JSON), ASSETS (CSS /
 * ZIP) — each row prefixed with a 4ch mono format glyph so the popover
 * reads like a directory listing. Visible button text is unchanged so
 * existing e2e label matchers (#125) keep working.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
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
import { usePopover } from '../utils/usePopover';
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
  /**
   * Current print mode — baked into the HTML/ZIP exports so a download
   * mirrors the chosen appearance. The mode is CHANGED elsewhere now (the
   * canonical Fit-chip control, #200); the panel only reads it.
   */
  printMode: PrintMode;
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

/**
 * Renders a 4ch monospace glyph slot before a download row's label.
 *
 * The glyph is decorative — the visible button text already names the
 * format — so it's hidden from assistive tech. Width is fixed in CSS to
 * keep every row's label column aligned, terminal-listing style.
 */
function FormatGlyph({ children }: { children: string }) {
  return (
    <span className="export-panel__glyph" aria-hidden="true">
      {children}
    </span>
  );
}

export default function ExportPanel({
  markdown,
  parsed,
  theme,
  template = DEFAULT_RESUME_TEMPLATE,
  printMode,
  onClose,
  triggerRef,
  previewRef,
}: ExportPanelProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstControlRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const hasResume = parsed !== null;

  /* "Copy theme link" — relocated from ThemeControls in #112. Sits inside the
     Share group below the downloads; it's a low-frequency action and didn't
     deserve a permanent toolbar slot. Confirmation pip auto-clears after 2 s,
     same UX as the old toolbar affordance. */
  const [linkCopied, setLinkCopied] = useState(false);
  const linkCopyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (linkCopyTimer.current) clearTimeout(linkCopyTimer.current);
    };
  }, []);

  const copyThemeLink = useCallback(async () => {
    const url = `${location.origin}${location.pathname}?theme=${theme.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      if (linkCopyTimer.current) clearTimeout(linkCopyTimer.current);
      linkCopyTimer.current = setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Clipboard API unavailable or denied — degrade to a prompt so the
      // user can still copy the link manually.
      window.prompt('Copy this theme link:', url);
    }
  }, [theme.slug]);

  /* On open: focus the first actionable control (not the Close button). This
     is the panel's UNIQUE open-focus behavior, so it stays in the component;
     the shared hook owns only dismiss + focus-RESTORE. */
  useEffect(() => {
    firstControlRef.current?.focus();
  }, []);

  /* Non-modal dismiss/focus plumbing (#202). The panel is mounted only while
     open, so the hook runs with `open: true` and uses the `'unmount'` restore
     policy — focus returns to the trigger on EVERY close path (Escape, the
     close button, outside-click), reproducing the old unmount-cleanup restore.
     Escape is scoped to the dialog ELEMENT via `popoverProps.onKeyDown` so its
     `stopPropagation` lets a host MobileToolbarSheet defer (#207). */
  const { popoverProps } = usePopover({
    open: true,
    onClose,
    containerRef: dialogRef,
    triggerRef,
    restoreFocus: 'unmount',
  });

  return (
    <div
      ref={dialogRef}
      className="export-panel__dialog"
      role="dialog"
      aria-modal="false"
      aria-labelledby={headingId}
      onKeyDown={popoverProps.onKeyDown}
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

      {/* ----- MODE — print appearance toggle -----
           Applies to the in-app print path AND to the HTML/ZIP downloads
           (they bake `data-print-mode` into the exported file). Lives at
           the top because it gates how PDF/HTML render below. */}
      {/* Print appearance is set by the canonical Fit-chip control (#200) —
          the panel no longer duplicates the radios, but notes where to change
          it so the HTML/PDF/ZIP appearance stays discoverable. The {' '}
          duplicate "Print / Save as PDF" button is gone too (#201): Save as
          PDF lives once, in the toolbar. */}
      <p className="export-panel__mode-note">
        HTML &amp; PDF use the{' '}
        <strong>{printMode === 'theme' ? 'current theme' : 'conservative'}</strong> print mode —
        change it in the Fit chip.
      </p>

      {/* ----- DOCUMENT — human-readable resume artifacts -----
           Alternate document formats (MD / HTM). Each row leads with a 4ch
           mono format glyph so the popover reads like a directory listing.
           Save-as-PDF is intentionally NOT here — it's the toolbar's job. */}
      <div className="export-panel__section">
        <span className="export-panel__group-label">Document</span>
        <div className="export-panel__buttons">
          <button
            ref={firstControlRef}
            type="button"
            className="btn"
            disabled={!hasResume}
            onClick={() => {
              if (parsed) downloadMarkdown(markdown, parsed.frontmatter);
            }}
          >
            <FormatGlyph>MD</FormatGlyph>
            <span>Download Markdown (.md)</span>
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
            <FormatGlyph>HTM</FormatGlyph>
            <span>Download HTML (.html)</span>
          </button>
        </div>
      </div>

      {/* ----- DATA — machine-readable resume artifacts -----
           Plain text (ATS pipelines) and JSON Resume (programmatic
           re-import + downstream tooling). */}
      <div className="export-panel__section">
        <span className="export-panel__group-label">Data</span>
        <div className="export-panel__buttons">
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
            <FormatGlyph>TXT</FormatGlyph>
            <span>Download plain text (.txt)</span>
          </button>
          <button
            type="button"
            className="btn"
            disabled={!hasResume}
            onClick={() => {
              if (parsed) downloadJsonResume(toJsonResume(parsed, markdown));
            }}
          >
            <FormatGlyph>JSON</FormatGlyph>
            <span>Download JSON Resume (.json)</span>
          </button>
        </div>
      </div>

      {/* ----- ASSETS — supporting files -----
           Theme CSS by itself (theme-only consumers) and the full ZIP
           bundle (resume.md + resume.html + theme.css). */}
      <div className="export-panel__section">
        <span className="export-panel__group-label">Assets</span>
        <div className="export-panel__buttons">
          <button type="button" className="btn" onClick={() => downloadThemeCss(theme)}>
            <FormatGlyph>CSS</FormatGlyph>
            <span>Download theme CSS (.css)</span>
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
            <FormatGlyph>ZIP</FormatGlyph>
            <span>Download as .zip</span>
          </button>
        </div>
        <p className="export-panel__note">
          Downloads are generated in your browser. Nothing is uploaded. The .zip bundles the
          Markdown, the standalone HTML, and the theme CSS.
        </p>
      </div>

      {/* ----- Share group (#112) -----
           "Copy theme link" used to sit in the toolbar's ThemeControls cluster.
           It was a low-frequency action and contributed to the toolbar growing
           to three rows on common desktop widths. Relocated here so the
           toolbar can fit in two rows; the affordance is still discoverable
           from `e` → Export. Only the theme slug is copied; never resume
           content. */}
      <div className="export-panel__section">
        <span className="export-panel__group-label">Share</span>
        <div className="export-panel__buttons">
          <button type="button" className="btn" onClick={copyThemeLink}>
            Copy theme link
          </button>
          {linkCopied && (
            <span className="export-panel__copied" role="status">
              <Icon name="check" size={13} /> Copied
            </span>
          )}
        </div>
        <p className="export-panel__note">
          Copies a URL that opens this app with the same theme pre-selected. No resume content is
          included.
        </p>
      </div>
    </div>
  );
}

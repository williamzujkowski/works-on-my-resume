/**
 * PrintPreviewDialog — modal "what your PDF will actually look like" preview
 * (#185).
 *
 * Why this exists. Before #185 the only path to a PDF was the Save-as-PDF
 * toolbar button, which jumps straight into the browser's native print
 * dialog — no inline review, no way to flip print modes without closing the
 * dialog, going back to the toolbar, toggling, then re-opening. The user's
 * first chance to see how the print is going to look was the OS-level print
 * sheet. This modal closes that gap: a Preview button next to Save-as-PDF
 * opens an inline preview that renders the exact standalone-HTML export the
 * download path produces, with the print-mode radio threaded through so the
 * page-fit chip's mode dropdown and the modal are a single source of truth.
 *
 * Render strategy
 * ---------------
 * The standalone HTML export pipeline (`buildStandaloneHtml`) already
 * produces the canonical printable document — the same one the Download HTML
 * affordance writes to disk and that an `@media print` sheet would render
 * against in the parent document. We reuse it verbatim. The result is
 * loaded into a sandboxed `<iframe>` via a Blob URL: data: URIs are clean in
 * theory but trip up our auto-CSP because `frame-src 'self'` does not cover
 * `data:` schemes; blob: URLs are same-origin from the iframe's point of
 * view, so a single `frame-src 'self' blob:` directive (added in
 * astro.config.mjs) is enough. The blob URL is revoked on unmount.
 *
 * The iframe uses `sandbox="allow-same-origin"` ONLY. No scripts run inside
 * it — and the standalone HTML carries no scripts anyway. Same-origin is
 * needed so the e2e harness can read `body[data-print-mode]` out of the
 * iframe's content document and assert the mode toggle wired through.
 *
 * Sizing
 * ------
 * The iframe is anchored at a US-Letter aspect ratio (8.5/11 portrait).
 * Default scale on desktop is ~0.6× so a 1440-px-wide modal can show the
 * page roughly at natural size on smaller screens too; multi-page resumes
 * scroll vertically inside the iframe. Mobile fills the viewport.
 *
 * Accessibility
 * -------------
 * Mirrors ExampleDialog / FormatDocsDialog / KeyboardHelp:
 *   - `role="dialog"` + `aria-modal="true"` + `aria-labelledby` heading id
 *   - Focus moves to the close button on open
 *   - Tab/Shift+Tab cycle within the dialog
 *   - Esc closes, click-outside closes
 *   - The caller restores focus to the trigger on unmount (ResumeStudio side)
 *
 * CSP
 * ---
 * No inline `style={...}` attributes — every visual lives in global.css
 * under `.print-preview*`. The iframe is loaded via Blob URL; the parent
 * `frame-src` directive covers it. The standalone HTML embeds its own
 * stylesheet (theme variables + resume.css + STANDALONE_EXPORT_CSS) — no
 * extra network requests, no scripts.
 */
import { useCallback, useEffect, useId, useMemo, useRef } from 'react';
import type { ParsedResume, PrintMode, ResumeTemplate, ResumeTheme } from '../types';
import { buildStandaloneHtml } from '../utils/export';
import Icon from './Icon';

/** Selector matching every focusable element for the focus trap. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface PrintPreviewDialogProps {
  /** Parsed resume — name + html + frontmatter. */
  parsed: ParsedResume;
  /** Active theme; embedded as CSS variables in the standalone HTML. */
  theme: ResumeTheme;
  /** Active layout template. */
  template: ResumeTemplate;
  /** Current print mode — drives the embedded `body[data-print-mode]`. */
  printMode: PrintMode;
  /** Print-mode radio change. Threads up to ResumeStudio so the page-fit
      chip's mode and this modal stay in lockstep — single source of truth. */
  onPrintModeChange: (mode: PrintMode) => void;
  /** Close request — Esc, click-outside, Cancel button, or the explicit
      close glyph in the header. */
  onClose: () => void;
}

export default function PrintPreviewDialog({
  parsed,
  theme,
  template,
  printMode,
  onPrintModeChange,
  onClose,
}: PrintPreviewDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const descId = useId();

  /* ----- Standalone HTML + Blob URL.
       buildStandaloneHtml is sync and deterministic — same inputs, same
       output — so memoizing on the inputs is the right shape. The Blob URL
       is allocated alongside it, and the previous URL is revoked when the
       memo recomputes (printMode changes, theme changes, etc.) so we never
       leak object URLs over a long-lived modal session. */
  const blobUrl = useMemo(() => {
    const html = buildStandaloneHtml(parsed.html, theme, parsed.frontmatter, template, printMode);
    const blob = new Blob([html], { type: 'text/html' });
    return URL.createObjectURL(blob);
  }, [parsed.html, parsed.frontmatter, theme, template, printMode]);

  /* Revoke the Blob URL when the memo recomputes (the previous URL becomes
     orphaned) and on unmount. The cleanup runs BEFORE the next effect, so
     `blobUrl` here is the previous one. */
  useEffect(() => {
    return () => {
      URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  /* On open: move focus to the Close button so keyboard users land inside. */
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  /* Trap focus and handle Escape entirely within the dialog. Mirrors the
     KeyboardHelp / ExampleDialog / FormatDocsDialog pattern verbatim so
     behavior between the app modals is identical. */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !root.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  /* "Save as PDF" inside the modal — same path the toolbar's Save-as-PDF
     button takes. `window.print()` picks up `document.body.dataset.printMode`,
     which ResumeStudio keeps in sync with the same `printMode` state thread
     this modal reads, so the printed output mirrors the previewed iframe
     content. Close the modal first so the print sheet doesn't paint over a
     stale preview frame. */
  const handleSave = useCallback(() => {
    onClose();
    // Defer the print sheet so the dialog has had a chance to unmount and
    // the focus has returned to the trigger button.
    window.setTimeout(() => window.print(), 0);
  }, [onClose]);

  /* Title for the iframe — `aria-label` is per the WCAG iframe guidance.
     We use the resume name when available, falling back to a generic. */
  const frameTitle = (() => {
    const name = parsed.frontmatter?.name?.trim();
    return name ? `Print preview of ${name}'s resume` : 'Print preview';
  })();

  return (
    <div
      className="print-preview-dialog__overlay"
      onPointerDown={onClose}
      data-print-hide
    >
      <div
        ref={dialogRef}
        className="print-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descId}
        onKeyDown={handleKeyDown}
        /* Clicks inside must not bubble to the overlay's dismiss handler. */
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="print-preview-dialog__header">
          <h2 id={headingId} className="print-preview-dialog__title">
            Print preview
          </h2>
          <button
            type="button"
            ref={closeButtonRef}
            className="btn btn--ghost btn--icon"
            onClick={onClose}
            aria-label="Close print preview"
          >
            <Icon name="close" />
          </button>
        </div>

        <p id={descId} className="print-preview-dialog__intro">
          This is what the saved PDF will look like. Toggle the print mode to
          compare; nothing is uploaded.
        </p>

        {/* ----- Mode toggle — same shape as ExportPanel's radio group.
            The state is owned by ResumeStudio so the page-fit chip's mode
            dropdown stays in lockstep with this modal (single source of
            truth). */}
        <fieldset className="print-preview-dialog__modes">
          <legend className="visually-hidden">Print mode</legend>
          <label className="print-preview-dialog__mode">
            <input
              type="radio"
              name="print-preview-mode"
              checked={printMode === 'conservative'}
              onChange={() => onPrintModeChange('conservative')}
            />
            <span>
              Conservative
              <span className="print-preview-dialog__mode-hint">
                White paper, black ink — ATS- and printer-friendly.
              </span>
            </span>
          </label>
          <label className="print-preview-dialog__mode">
            <input
              type="radio"
              name="print-preview-mode"
              checked={printMode === 'theme'}
              onChange={() => onPrintModeChange('theme')}
            />
            <span>
              Themed
              <span className="print-preview-dialog__mode-hint">
                Print using the &ldquo;{theme.name}&rdquo; colors.
              </span>
            </span>
          </label>
        </fieldset>

        {/* ----- The iframe.
            sandbox="allow-same-origin" lets the e2e harness reach into the
            iframe's content document to read `body[data-print-mode]`. No
            scripts run inside — the standalone HTML has none, and we
            intentionally do NOT grant `allow-scripts`. The Blob URL is
            revoked on unmount + on prop changes.

            A stable React `key` on the iframe forces React to drop and
            re-create the element when the blob URL changes, so the
            browser-side loader fully re-fetches the new blob instead of
            keeping the previous document around — important on mode toggle
            so the preview reflects the new `data-print-mode`. */}
        <div className="print-preview-dialog__frame-wrap">
          <iframe
            key={blobUrl}
            className="print-preview-dialog__frame"
            src={blobUrl}
            title={frameTitle}
            sandbox="allow-same-origin"
            data-testid="print-preview-frame"
          />
        </div>

        <div className="print-preview-dialog__actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={handleSave}>
            <Icon name="file" size={14} />
            Save as PDF
          </button>
        </div>
      </div>
    </div>
  );
}

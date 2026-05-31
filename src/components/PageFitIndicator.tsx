/**
 * PageFitIndicator — toolbar pill that reports the approximate printed
 * length of the rendered resume, with a popover offering per-section
 * heights, trim suggestions, and a visual page-break ruler overlay (#92).
 *
 * Pure local computation: no network, no storage. The pill reads
 * `getBoundingClientRect` on the rendered `.resume-preview` article inside
 * `previewRef` and divides by the US-Letter @ 0.6in content height. See
 * `src/utils/pageFit.ts` for the math; this component is just the UI.
 *
 * Re-measurement triggers:
 *   - `ResizeObserver` on the preview pane (so theme / template swaps that
 *     change the article height retrigger).
 *   - Re-runs whenever `parsed` (the parsed-resume object) changes, since
 *     swapping in new markdown obviously changes the height.
 *   - Two rAF ticks after each `parsed` change, to catch font/image loads.
 *
 * CSP: no JSX `style={...}` attributes. The two places that paint a
 * computed pixel value (the ruler offsets) write via CSSOM in a
 * `useLayoutEffect` — the same pattern as ThemePicker's ThemeSwatch /
 * AccentDot. CSSOM mutations are governed by `script-src`, not
 * `style-src`, so this dodges `'unsafe-inline'` cleanly.
 *
 * The ruler overlay is rendered into the preview pane via `createPortal`
 * so it sits inside the pane's positioning context. It is opt-in (a
 * checkbox in the popover) and defaults OFF so the preview reads clean
 * by default.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { usePopover } from '../utils/usePopover';
import type { ParsedResume, PrintMode, ResumeTemplate } from '../types';
import {
  estimatePages,
  fitSeverity,
  formatPagesLabel,
  PAGE_CONTENT_PX_AT_96DPI,
  sectionHeights,
  trimSuggestions,
  type FitSeverity,
  type SectionMeasurement,
  type TrimSuggestion,
} from '../utils/pageFit';
import Icon from './Icon';

interface PageFitIndicatorProps {
  /**
   * The preview pane element — `ResumeStudio` already holds this ref on the
   * `studio__pane-body` that wraps the rendered `<article class="resume-preview">`.
   * We query the article from within so the component owns its own DOM
   * boundary; the wrapping pane handles theme + ATS data attributes.
   */
  previewRef: React.RefObject<HTMLElement | null>;
  /** Currently active layout template — drives the "Switch to Compact" hint. */
  layout: ResumeTemplate;
  /**
   * Parsed resume; null in Phase 1 (no resume loaded). The component is
   * already gated on `hasResume` at the callsite, but accepting `null` here
   * keeps it self-defensive in case future callers forget. When `parsed` is
   * null the pill renders nothing.
   */
  parsed: ParsedResume | null;
  /**
   * Current print mode (#139). Surfaces the previously-hidden Export-panel
   * toggle as a second segment of the chip so the user can see — at all
   * times — what colour profile the Fit estimate and Save-as-PDF will use.
   */
  printMode: PrintMode;
  /** Setter for the print mode; mirrors the Export-panel radio. */
  onPrintModeChange: (mode: PrintMode) => void;
  /**
   * Per-session body-font shift in points (#186). Range [-2, 2] in 0.5pt
   * steps; default 0. ResumeStudio owns the value and applies it via the
   * `--resume-body-size-shift` custom property; this component only renders
   * the +/- controls flanking the chip.
   */
  bodySizeShift: number;
  /** Setter for the body-font shift; clamped at the callsite. */
  onBodySizeShiftChange: (shift: number) => void;
}

/**
 * Step size, clamp bounds, and default for the body-font shift (#186). Lives
 * here as named constants so the buttons can disable at the boundary AND so
 * the e2e test can assert the same numbers without re-deriving them.
 */
export const BODY_SIZE_SHIFT_STEP = 0.5;
export const BODY_SIZE_SHIFT_MIN = -2;
export const BODY_SIZE_SHIFT_MAX = 2;

/* ---------------------------------------------------------------------------
 * RulerOverlay — CSSOM-painted page-break overlay.
 *
 * Renders a stack of absolutely-positioned horizontal dashed lines at
 * y = N * pageContentPx (relative to the preview article's content box).
 * Each line carries a small "Page N" label. CSP-friendly because the only
 * dynamic style (the `top` / `left` / size values) is written via
 * `el.style.setProperty` inside a `useLayoutEffect`.
 * ------------------------------------------------------------------------ */

interface RulerOverlayProps {
  /** The pane the ruler is portal-mounted into (positions relative to this). */
  parent: HTMLElement;
  /** The `.resume-preview` article whose top we anchor against. */
  article: HTMLElement;
  /** Number of page-break lines to draw. */
  lineCount: number;
}

function RulerOverlay({ parent, article, lineCount }: RulerOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Position the overlay over the article's content box, relative to the
    // pane. parent / article rects are read in the same frame so the math
    // is internally consistent even if a layout pass changes things.
    const parentRect = parent.getBoundingClientRect();
    const articleRect = article.getBoundingClientRect();
    const top = articleRect.top - parentRect.top + parent.scrollTop;
    const left = articleRect.left - parentRect.left + parent.scrollLeft;
    root.style.setProperty('top', `${top}px`);
    root.style.setProperty('left', `${left}px`);
    root.style.setProperty('width', `${articleRect.width}px`);
    root.style.setProperty('height', `${articleRect.height}px`);
    // Paint each child line's top offset. Indices are 1-based ("Page 2" is
    // drawn one page-height down from the article top).
    const lines = root.querySelectorAll<HTMLDivElement>('[data-ruler-line]');
    lines.forEach((line, index) => {
      const lineTop = (index + 1) * PAGE_CONTENT_PX_AT_96DPI;
      line.style.setProperty('top', `${lineTop}px`);
    });
  });

  return (
    <div ref={rootRef} className="page-fit-ruler" aria-hidden="true" data-print-hide>
      {Array.from({ length: lineCount }, (_, i) => (
        <div key={`ruler-${i}`} className="page-fit-ruler__line" data-ruler-line>
          <span className="page-fit-ruler__label">Page {i + 2}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * PageFitIndicator
 * ------------------------------------------------------------------------ */

export default function PageFitIndicator({
  previewRef,
  layout,
  parsed,
  printMode,
  onPrintModeChange,
  bodySizeShift,
  onBodySizeShiftChange,
}: PageFitIndicatorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  /* The rendered <article class="resume-preview"> inside the preview pane.
     We snapshot it on each measurement pass; React's preview re-renders may
     produce a fresh article element when `parsed` changes. */
  const [article, setArticle] = useState<HTMLElement | null>(null);

  /* Measurement state. `pages` is the float; `sections` is the per-section
     breakdown for the popover. Both update via the same effect. */
  const [pages, setPages] = useState(0);
  const [sections, setSections] = useState<readonly SectionMeasurement[]>([]);

  const [open, setOpen] = useState(false);
  const [rulerOn, setRulerOn] = useState(false);

  const labelId = useId();
  const popoverId = useId();
  const sizeLabelId = useId();

  /* ---- One measurement pass. Reads the article we currently know about,
         OR re-queries the preview pane for one if the cached reference is
         stale. Idempotent and cheap; safe to call from ResizeObserver. ---- */
  const measure = useCallback(() => {
    const pane = previewRef.current;
    if (!pane) {
      setPages(0);
      setSections([]);
      setArticle(null);
      return;
    }
    const liveArticle =
      article && pane.contains(article)
        ? article
        : pane.querySelector<HTMLElement>('.resume-preview');
    if (!liveArticle) {
      setPages(0);
      setSections([]);
      setArticle(null);
      return;
    }
    if (liveArticle !== article) setArticle(liveArticle);
    setPages(estimatePages(liveArticle));
    setSections(sectionHeights(liveArticle));
  }, [article, previewRef]);

  /* Initial measurement + a tiny rAF chain re-measurement so a freshly-loaded
     resume (whose article appears one render after `parsed` arrives) is
     caught. Re-runs whenever the parsed object changes. */
  useEffect(() => {
    if (!parsed) return;
    measure();
    const r1 = window.requestAnimationFrame(() => {
      measure();
      // Second tick: catches font loads / image decodes that briefly shift
      // the layout after the first paint.
      window.requestAnimationFrame(measure);
    });
    return () => window.cancelAnimationFrame(r1);
  }, [parsed, layout, measure]);

  /* ResizeObserver on the preview pane — fires for theme / template / window
     resizes that change the article height. We observe the pane (a stable
     element) rather than the article (which may be recreated). */
  useEffect(() => {
    const pane = previewRef.current;
    if (!pane || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(pane);
    return () => observer.disconnect();
  }, [previewRef, measure]);

  /* Non-modal dismiss/focus plumbing (#202).

     Outside-click containment is the WHOLE chip (`rootRef`) — it wraps the
     trigger, the print-mode `<select>`, AND the popover — so clicking the
     trigger or the mode dropdown never self-closes. The ruler overlay is
     `createPortal`ed OUTSIDE `rootRef` into the preview pane and is
     deliberately NOT listed as an extra-inside element, so a pointer-down on
     the ruler reads as "outside" and closes the popover — preserving the
     historical behavior.

     Escape moves from the old document-level listener onto the popover
     ELEMENT (`popoverProps.onKeyDown`, via `popoverRef`'s div). The
     element-scoped `stopPropagation` lets a host MobileToolbarSheet defer so
     the popover closes first (#207) — the document-level Escape this replaced
     could not. Focus restores to the trigger on Escape; the explicit close
     button restores inline below. */
  const onClose = useCallback(() => setOpen(false), []);
  const { popoverProps } = usePopover({
    open,
    onClose,
    containerRef: rootRef,
    triggerRef,
  });

  const severity: FitSeverity = useMemo(() => fitSeverity(pages), [pages]);
  const label = useMemo(() => formatPagesLabel(pages), [pages]);

  const suggestions: readonly TrimSuggestion[] = useMemo(
    () => trimSuggestions(sections, layout, pages),
    [sections, layout, pages],
  );

  /* Ruler line count: number of FULL page heights that fit inside the
     article. (A 1.4-page resume gets 1 line at y = 1 page; a 2.3-page resume
     gets 2 lines, at y = 1 and y = 2 pages.) Clamped at zero so a sub-page
     article never renders an empty overlay. */
  const rulerLineCount = Math.max(0, Math.floor(pages));

  /* The pane the ruler portals into. We mount the portal as a child of the
     preview pane so the absolute-positioned overlay anchors to a stable,
     positioned container. */
  const pane = previewRef.current;

  /* Make sure the pane is a positioning context when the ruler is on. We add
     the class via a layout effect so it doesn't write a style attribute. */
  useLayoutEffect(() => {
    if (!pane) return;
    if (rulerOn) {
      pane.classList.add('studio__pane-body--has-ruler');
      return () => pane.classList.remove('studio__pane-body--has-ruler');
    }
    return undefined;
  }, [pane, rulerOn]);

  if (!parsed) return null;

  const chipClass = chipSeverityClass(severity);
  const triggerClass = triggerSeverityClass(severity);
  const modeSelectClass = modeSeverityClass(severity);
  const pillLabel =
    severity === 'ok'
      ? `${label} — preview fits a single printed page`
      : `${label} — preview exceeds a single printed page; click for trim suggestions`;
  /* Print-mode dropdown reads as the chip's second segment (#139). Native
     `<select>` so keyboard, AT, and mobile pickers are all free out of the
     box. The label string mirrors the radio inside the Export panel; the
     dropdown's aria-label spells out that the choice affects BOTH the
     in-app print path AND the Fit estimate so the previously-hidden link
     is no longer hidden. */
  const modeAriaLabel =
    'Print mode — affects the Save as PDF output and the Fit-pages estimate';

  /* Button-disabled state at the clamp boundary (#186). The boundary is a
     half-pt past the last legal shift; using a small epsilon (1e-3) avoids
     a floating-point mismatch where -2 + 0.5 + 0.5 + 0.5 + 0.5 = -0.000...001. */
  const atMinShift = bodySizeShift <= BODY_SIZE_SHIFT_MIN + 1e-3;
  const atMaxShift = bodySizeShift >= BODY_SIZE_SHIFT_MAX - 1e-3;

  const decreaseShift = () => {
    if (atMinShift) return;
    const next = Math.max(BODY_SIZE_SHIFT_MIN, bodySizeShift - BODY_SIZE_SHIFT_STEP);
    onBodySizeShiftChange(next);
  };
  const increaseShift = () => {
    if (atMaxShift) return;
    const next = Math.min(BODY_SIZE_SHIFT_MAX, bodySizeShift + BODY_SIZE_SHIFT_STEP);
    onBodySizeShiftChange(next);
  };

  const shiftLabel =
    bodySizeShift === 0
      ? 'Default'
      : `${bodySizeShift > 0 ? '+' : ''}${bodySizeShift}pt`;

  return (
    <div className="page-fit__size-control" data-print-hide>
      {/* Escape is scoped to the chip wrapper (which holds the trigger, the
          mode select, AND the popover) rather than the popover div, because
          on open PageFit leaves focus on the TRIGGER — a sibling of the
          popover — so a keydown there never bubbles into the popover. The
          chip is the nearest common ancestor of both, and the hook's `open`
          guard keeps `stopPropagation` from firing while the popover is
          closed (so a host sheet's Escape still works then). */}
      <div
        className={chipClass}
        ref={rootRef}
        data-print-hide
        onKeyDown={popoverProps.onKeyDown}
      >
        <button
          type="button"
          ref={triggerRef}
          className={triggerClass}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={popoverId}
          aria-label={pillLabel}
          onClick={() => setOpen((prev) => !prev)}
        >
          <span className="page-fit__dot" aria-hidden="true" />
          {/* The label already leads with `Fit:` / `Fits` — that prefix IS
              the kicker rhythm for this control. The leading "Fit" text
              is styled with the section-kicker tone via the `::first-word`
              shaping below in CSS; visible label content stays
              unchanged so existing `Fits 1 page` / `Fit: 1.4 pages`
              regex matchers keep working (#135). */}
          <span className="page-fit__label" id={labelId}>
            {label}
          </span>
        </button>
        <span className="page-fit__mode-sep" aria-hidden="true">
          ·
        </span>
        <span className="page-fit__mode">
          <select
            className={modeSelectClass}
            value={printMode}
            onChange={(event) => onPrintModeChange(event.target.value as PrintMode)}
            aria-label={modeAriaLabel}
          >
            <option value="conservative">Conservative</option>
            <option value="theme">Themed</option>
          </select>
          <span className="page-fit__mode-caret" aria-hidden="true">
            <Icon name="chevron-down" size={10} />
          </span>
        </span>

        {open && (
          <div
            id={popoverId}
            className="page-fit__popover"
            role="dialog"
            aria-modal="false"
            aria-label="Page fit details"
          >
            <div className="page-fit__popover-head">
              <p className="page-fit__popover-title">{label}</p>
              <button
                type="button"
                className="page-fit__close"
                aria-label="Close page-fit details"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                <Icon name="close" size={12} />
              </button>
            </div>

            <p className="page-fit__hint">
              <span className="page-fit__hint-icon" aria-hidden="true">
                <Icon name="info" size={12} />
              </span>
              Approximate — based on screen rendering, actual print may vary.
            </p>

            {sections.length > 0 && (
              <div className="page-fit__sections">
                <p className="page-fit__sections-title">Per-section share</p>
                <ul className="page-fit__sections-list">
                  {sections.map((section) => (
                    <li key={section.title} className="page-fit__section">
                      <span className="page-fit__section-name">{section.title}</span>
                      <span className="page-fit__section-pages">
                        {section.pages.toFixed(2)} pg
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {suggestions.length > 0 && (
              <div className="page-fit__suggestions">
                <p className="page-fit__suggestions-title">Suggestions to fit one page</p>
                <ul className="page-fit__suggestions-list">
                  {suggestions.map((suggestion) => (
                    <li key={suggestion.title} className="page-fit__suggestion">
                      <p className="page-fit__suggestion-title">{suggestion.title}</p>
                      {suggestion.detail && (
                        <p className="page-fit__suggestion-detail">{suggestion.detail}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <label className="page-fit__ruler-toggle">
              <input
                type="checkbox"
                checked={rulerOn}
                onChange={(event) => setRulerOn(event.target.checked)}
              />
              <span>Show page-break ruler on the preview</span>
            </label>

            {/* Body-font nudge (#186), relocated from the toolbar into the
                popover (#204) — it's a fit-tuning control, not a primary
                action, and the popover gives room for a visible shift
                readout the bare toolbar pair never had. */}
            <div className="page-fit__size-row">
              <span className="page-fit__size-label" id={sizeLabelId}>
                Body text size
              </span>
              <div
                className="page-fit__size-stepper"
                role="group"
                aria-labelledby={sizeLabelId}
              >
                <button
                  type="button"
                  className="page-fit__size-btn"
                  aria-label="Decrease body font size"
                  onClick={decreaseShift}
                  disabled={atMinShift}
                >
                  <span aria-hidden="true">
                    A<span className="page-fit__size-btn-op">−</span>
                  </span>
                </button>
                <span className="page-fit__size-value" aria-live="polite">
                  {shiftLabel}
                </span>
                <button
                  type="button"
                  className="page-fit__size-btn"
                  aria-label="Increase body font size"
                  onClick={increaseShift}
                  disabled={atMaxShift}
                >
                  <span aria-hidden="true">
                    A<span className="page-fit__size-btn-op">+</span>
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {rulerOn && pane && article && rulerLineCount > 0 &&
        createPortal(
          <RulerOverlay parent={pane} article={article} lineCount={rulerLineCount} />,
          pane,
        )}
    </div>
  );
}

/**
 * Map a fit-severity bucket to a class — used three times, once per segment
 * of the combined chip (#139). The chip is now a container that holds the
 * fit trigger AND the print-mode `<select>`; each segment carries the same
 * severity modifier so the colour reads continuously across the whole chip.
 */
function chipSeverityClass(severity: FitSeverity): string {
  const base = 'page-fit';
  if (severity === 'ok') return `${base} ${base}--ok`;
  if (severity === 'warn') return `${base} ${base}--warn`;
  return `${base} ${base}--danger`;
}

/** The fit-side button (FIT · 1.4p). */
function triggerSeverityClass(severity: FitSeverity): string {
  const base = 'page-fit__pill';
  if (severity === 'ok') return `${base} ${base}--ok`;
  if (severity === 'warn') return `${base} ${base}--warn`;
  return `${base} ${base}--danger`;
}

/** The mode-side `<select>` styled as the chip's second segment. */
function modeSeverityClass(severity: FitSeverity): string {
  const base = 'page-fit__mode-select';
  if (severity === 'ok') return `${base} ${base}--ok`;
  if (severity === 'warn') return `${base} ${base}--warn`;
  return `${base} ${base}--danger`;
}

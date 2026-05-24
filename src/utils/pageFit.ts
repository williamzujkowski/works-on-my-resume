/**
 * pageFit — approximate "how many printed pages will this be?" estimation.
 *
 * The studio is a screen-rendered React app. The toolbar's "Save as PDF" path
 * eventually hands the document to the browser's print pipeline, which honors
 * print.css and the body's 0.6in padding (see src/styles/print.css). That
 * means a rendered preview height in CSS pixels can be divided by the
 * available print content height to get a coarse-but-useful "pages" estimate.
 *
 * This is intentionally approximate. The screen render and the print render
 * are not pixel-identical — fonts subset differently, line-height rounding
 * differs, page-breaks may split a paragraph. The goal is *signal*: the user
 * should see "Fit: 1.4 pages" and reach for the compact layout, or "Fits 1
 * page" and stop worrying.
 *
 * The math (issue #92):
 *
 *   Letter at 0.6in margin = 11in - 1.2in = 9.8in content
 *   9.8in × 96 CSS px/in    = 940.8 CSS px @ 96 dpi
 *
 * All exported functions are pure: they take an HTMLElement (or measurements
 * derived from one) and return numbers / strings. No DOM mutation, no global
 * state. Components that consume them are free to call inside a
 * useLayoutEffect tied to a ResizeObserver, or once on demand.
 *
 * Browser-only: these helpers call `getBoundingClientRect`, which has no
 * server-side analogue. The callsites are React components mounted as Astro
 * islands (`client:load`), so `typeof window` is always defined.
 *
 * @example
 *   const previewEl = document.querySelector<HTMLElement>('.resume-preview');
 *   if (previewEl) {
 *     const pages = estimatePages(previewEl); // e.g. 1.42
 *     const label = formatPagesLabel(pages);  // "Fit: 1.4 pages"
 *   }
 */

/** US Letter content height at the canonical 0.6in print margin, in CSS px. */
export const PAGE_CONTENT_PX_AT_96DPI = 9.8 * 96; // = 940.8

/**
 * Returns the available content height in CSS pixels for the print page.
 * Parameterized for future use (Legal, A4); defaults to Letter @ 0.6in.
 *
 * @param marginIn — page margin in inches (each side, top/bottom). Default 0.6.
 * @param pageHeightIn — full page height in inches. Default 11 (Letter).
 * @returns content area height in CSS pixels at 96 dpi.
 *
 * @example
 *   pageContentPxAt96dpi();             // 940.8 (Letter, 0.6in)
 *   pageContentPxAt96dpi(0.5);          // 960   (Letter, 0.5in)
 *   pageContentPxAt96dpi(0.6, 14);      // 1267.2 (Legal)
 */
export function pageContentPxAt96dpi(marginIn = 0.6, pageHeightIn = 11): number {
  return (pageHeightIn - marginIn * 2) * 96;
}

/**
 * Estimate the printed page count of `previewEl` (the `.resume-preview`
 * article). Reads its rendered height with `getBoundingClientRect`, divides
 * by the available print content height.
 *
 * Returns 0 when the element has no measurable height (e.g. detached or
 * display:none) so callers can no-op cleanly. Otherwise returns a positive
 * float (`1.0` means "exactly one page", `1.42` means "about 1.4 pages").
 *
 * @example
 *   estimatePages(previewEl); // e.g. 1.42
 *   estimatePages(detachedEl); // 0
 */
export function estimatePages(previewEl: HTMLElement | null): number {
  if (!previewEl) return 0;
  const rect = previewEl.getBoundingClientRect();
  if (rect.height <= 0) return 0;
  return rect.height / PAGE_CONTENT_PX_AT_96DPI;
}

/**
 * Format `pages` as the toolbar pill label.
 *
 * Rules (#92):
 *   - `pages ≤ 1.0`           → "Fits 1 page"
 *   - `pages  > 1.0`          → "Fit: {pages.toFixed(1)} pages"
 *   - `pages` is rounded to one decimal for display only.
 *
 * @example
 *   formatPagesLabel(0);    // "Fits 1 page"     (no measurement yet)
 *   formatPagesLabel(0.83); // "Fits 1 page"
 *   formatPagesLabel(1);    // "Fits 1 page"
 *   formatPagesLabel(1.04); // "Fits 1 page"     (rounds to 1.0)
 *   formatPagesLabel(1.42); // "Fit: 1.4 pages"
 *   formatPagesLabel(2.31); // "Fit: 2.3 pages"
 */
export function formatPagesLabel(pages: number): string {
  // Round to one decimal first so a 1.04 estimate reads as "Fits 1 page"
  // rather than the pedantic "Fit: 1.0 pages".
  const rounded = Math.round(pages * 10) / 10;
  if (rounded <= 1.0) return 'Fits 1 page';
  return `Fit: ${rounded.toFixed(1)} pages`;
}

/** Severity bucket for the pill — drives color (accent / warning / danger). */
export type FitSeverity = 'ok' | 'warn' | 'danger';

/**
 * Classify a pages-estimate into a color severity for the pill.
 *
 *   - `≤ 1.0`     → 'ok'      (in accent / success color)
 *   - `1.0 – 2.0` → 'warn'    (over a page but not far)
 *   - `> 2.0`     → 'danger'  (well over)
 *
 * @example
 *   fitSeverity(0.9);  // 'ok'
 *   fitSeverity(1.42); // 'warn'
 *   fitSeverity(2.31); // 'danger'
 */
export function fitSeverity(pages: number): FitSeverity {
  const rounded = Math.round(pages * 10) / 10;
  if (rounded <= 1.0) return 'ok';
  if (rounded <= 2.0) return 'warn';
  return 'danger';
}

/** One measured section for the per-section popover row. */
export interface SectionMeasurement {
  /** Visible heading text — e.g. "Experience", "Education". */
  readonly title: string;
  /** Section height in CSS pixels, taken from `getBoundingClientRect`. */
  readonly heightPx: number;
  /** That height as a fraction of a single printed page (≥ 0). */
  readonly pages: number;
}

/**
 * Measure each top-level section in the rendered preview. A "section" is the
 * span of content between consecutive `<h2>` headings — the same rhythm the
 * resume markdown convention uses ("## Experience", "## Education", …).
 *
 * Sections are returned in document order. The final section runs from its
 * `h2` to the bottom of the preview. If the preview has no `h2` at all (a
 * malformed resume), an empty array is returned — callers should treat that
 * as "no per-section breakdown available" rather than an error.
 *
 * @example
 *   sectionHeights(previewEl);
 *   // [
 *   //   { title: 'Summary',    heightPx: 180, pages: 0.19 },
 *   //   { title: 'Experience', heightPx: 720, pages: 0.77 },
 *   //   { title: 'Education',  heightPx: 240, pages: 0.26 },
 *   // ]
 */
export function sectionHeights(previewEl: HTMLElement | null): readonly SectionMeasurement[] {
  if (!previewEl) return [];
  const headings = Array.from(previewEl.querySelectorAll<HTMLHeadingElement>('h2'));
  if (headings.length === 0) return [];

  const previewRect = previewEl.getBoundingClientRect();
  const previewBottom = previewRect.bottom;
  const results: SectionMeasurement[] = [];

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]!;
    const top = heading.getBoundingClientRect().top;
    const nextTop =
      i + 1 < headings.length
        ? headings[i + 1]!.getBoundingClientRect().top
        : previewBottom;
    const heightPx = Math.max(0, nextTop - top);
    const title = (heading.textContent ?? '').trim() || `Section ${i + 1}`;
    results.push({
      title,
      heightPx,
      pages: heightPx / PAGE_CONTENT_PX_AT_96DPI,
    });
  }

  return results;
}

/** One trim suggestion shown in the popover when the resume is over a page. */
export interface TrimSuggestion {
  /** Short headline shown as the suggestion's main text. */
  readonly title: string;
  /** Optional one-line elaboration shown below the title. */
  readonly detail?: string;
}

/**
 * Produce 2–3 short, actionable trim suggestions for a preview that is
 * estimated to exceed one page. Returns an empty array when `pages ≤ 1.0`.
 *
 * The suggestions are heuristic — they look at the active layout, the
 * tallest sections, and whether any standard "trim candidates" (Summary,
 * Education, Earlier roles) are present. The popover only renders the first
 * three returned, so callers can pass through the full list.
 *
 * @example
 *   trimSuggestions([...], 'classic', 1.4);
 *   // [
 *   //   { title: 'Switch to Compact layout', detail: 'Trims margins...' },
 *   //   { title: 'Trim oldest role', detail: 'Earlier roles is your tallest section.' },
 *   // ]
 *
 *   trimSuggestions([...], 'classic', 0.9);  // []
 */
export function trimSuggestions(
  sections: readonly SectionMeasurement[],
  currentLayout: string,
  pages: number,
): readonly TrimSuggestion[] {
  if (pages <= 1.0) return [];
  const out: TrimSuggestion[] = [];

  // 1. Layout swap — only when the user is not already on Compact. This is
  //    the lowest-effort win, so it leads.
  if (currentLayout !== 'compact') {
    out.push({
      title: 'Switch to Compact layout',
      detail: 'Tighter margins and spacing reclaim about a quarter-page on average.',
    });
  }

  // Case-insensitive title lookup so "Summary" / "summary" both match.
  const byTitle = (needle: RegExp) =>
    sections.find((s) => needle.test(s.title));

  // 2. Long Summary — a Summary that runs longer than ~3 lines is a common
  //    over-page culprit. We approximate "3 lines" as ~75 CSS px of section
  //    height (1.6 line-height × ~16px × 3 ≈ 77px). The number is intentionally
  //    coarse — this is signal, not precision.
  const summary = byTitle(/^(summary|profile|about)$/i);
  if (summary && summary.heightPx > 110) {
    out.push({
      title: 'Shorten Summary to 3 lines or fewer',
      detail: `Your Summary is about ${summary.pages.toFixed(2)} of a page — a tight 2-3 line lead reads stronger.`,
    });
  }

  // 3. Earlier-roles / older Experience — frequently the trimmable tail.
  const earlier = byTitle(/(earlier roles|prior roles|other (experience|positions))/i);
  if (earlier) {
    out.push({
      title: 'Trim oldest role (Earlier roles)',
      detail: 'Roles older than ~10 years rarely earn their space on a one-pager.',
    });
  } else {
    // No explicit Earlier-roles section: fall back to "trim the tallest one".
    const sorted = [...sections].sort((a, b) => b.heightPx - a.heightPx);
    const tallest = sorted[0];
    if (tallest && tallest.pages > 0.35) {
      out.push({
        title: `Tighten the "${tallest.title}" section`,
        detail: `It's your tallest section at about ${tallest.pages.toFixed(2)} of a page.`,
      });
    }
  }

  // Cap at three — keep the popover scannable.
  return out.slice(0, 3);
}

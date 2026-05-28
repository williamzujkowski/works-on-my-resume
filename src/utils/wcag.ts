/**
 * wcag.ts — shared WCAG-conformance helper.
 *
 * Maps a contrast ratio to its conformance level for normal-size body text.
 * Extracted here so the preview-pane WCAG badge in ResumeStudio (#88) and
 * the existing ThemePicker / ThemeControls badges share a single source.
 *
 * AAA ≥ 7:1, AA ≥ 4.5:1, otherwise fails AA. The thresholds match what
 * `ThemePicker.tsx` and `ThemeControls.tsx` use today; those files keep
 * their own private copies for now (they live behind a strict file-edit
 * boundary), but any new caller should import from here.
 */
export type WcagLevel = 'AAA' | 'AA' | 'fails AA';

/** Map a body-text contrast ratio to its WCAG conformance level. */
export function wcagLevel(ratio: number): WcagLevel {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  return 'fails AA';
}

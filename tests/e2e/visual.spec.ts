/**
 * visual.spec.ts — a small, deliberate visual-regression baseline.
 *
 * Three themes are screenshotted with the bundled sample resume:
 *   - github-light-default: the curated light fallback.
 *   - github-dark-default:  the curated dark fallback.
 *   - monoglow-light:       a synthesized-accent theme — the accent
 *     synthesis path is non-trivial output code we want a visual canary on.
 *
 * Each test captures the theme-picker trigger, which carries the theme
 * NAME plus an inline-styled swatch whose `background` and `borderColor`
 * come directly from the committed theme's tokens. Capturing just that
 * element gives a small, stable baseline that is genuinely theme-sensitive
 * (the swatch's pixels differ across themes) without coupling the test to
 * the much larger and less stable resume-document layout. Animations are
 * disabled via the global config.
 */
import { test, expect } from '@playwright/test';
import { clearAppStorage, loadSampleResume, waitForThemesReady } from './helpers';

/* Mobile baselines would multiply the snapshot count without adding much
   signal — keep visual regression desktop-only. */
test.skip(({ isMobile }) => isMobile, 'visual baseline is desktop-only');

const CASES = [
  { slug: 'github-light-default', label: 'github-light-default' },
  { slug: 'github-dark-default', label: 'github-dark-default' },
  /* `monoglow-light` is a synthesized-accent theme — its ANSI palette is
     too monochrome for the natural accent picker, so `accentSynthesized`
     is true and the accent goes through the contrast-synthesis path. */
  { slug: 'monoglow-light', label: 'monoglow-light-synth-accent' },
] as const;

for (const { slug, label } of CASES) {
  test(`preview matches baseline — ${label}`, async ({ page }, testInfo) => {
    // Skip on the mobile project: see `test.skip` above for the rationale.
    test.skip(testInfo.project.name !== 'chromium-desktop', 'desktop-only baseline');

    await clearAppStorage(page);
    await page.goto(`?theme=${slug}`);
    await loadSampleResume(page);
    /* After #80 the dataset loads lazily on idle — wait for it to be in
       place before snapshotting. Without this, the trigger could still
       show "WOMR Default" (the boot fallback) at snapshot time, then
       swap to the requested theme moments later. */
    await waitForThemesReady(page);

    /* Confirm the theme actually committed before snapshotting — both the
       URL slug AND the `data-resume-mode` attribute the engine sets when
       `applyThemeToDocument` runs. A diagnostic on these would catch a
       theme that silently failed to apply. */
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.resumeMode ?? ''))
      .not.toBe('');
    const committedSlug = await page.evaluate(() =>
      new URL(window.location.href).searchParams.get('theme'),
    );
    expect(committedSlug).toBe(slug);

    /* Tiny grace period for the parse debounce + theme crossfade to settle.
       Animations are already disabled, but the parse-tick is real. */
    await page.waitForTimeout(300);

    /* Snapshot the theme-picker trigger button. Its swatch carries the
       theme's `bg`/`accent` tokens as inline styles, and its label is the
       theme name — so a missed slug, a swatch-rendering regression, or a
       label-formatting change would all show up here. The trigger is a
       small, stable element whose box doesn't depend on the rendered
       resume's word-wrap or paragraph length. */
    const trigger = page.getByRole('button', { name: /^theme /i });
    await expect(trigger).toHaveScreenshot(`${label}.png`);
  });
}

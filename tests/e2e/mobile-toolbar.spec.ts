/**
 * mobile-toolbar.spec.ts — mobile "More" menu invariants (#131).
 *
 * On phone-sized viewports the toolbar wraps to four+ rows and consumes
 * the entire above-the-fold viewport before the resume preview is even
 * visible. The fix (option 2 from the issue) collapses everything except
 * ThemePicker + Save-as-PDF behind a single "More" trigger that opens a
 * stacked drawer over the toolbar.
 *
 * Invariants locked in here:
 *
 *  1. At iPhone 13 (390×844): the closed toolbar's visible bounding-box
 *     height is < 100 px — the resume header is preserved above the fold
 *     on first load.
 *  2. A "More" trigger is visible on mobile (and only on mobile).
 *  3. Clicking the trigger reveals at least three of the previously
 *     collapsed controls (Presets, Layout, Page-fit, Export, Settings).
 *  4. At 1280×800 the inline toolbar layout is unchanged from the #112
 *     two-row layout — the More trigger is hidden and the previously
 *     collapsed controls are visible inline.
 *  5. The mobile drawer is dismissable by Escape, and dismissing it
 *     returns focus to the trigger (a11y contract for `aria-haspopup`).
 */
import { test, expect } from '@playwright/test';
import { clearAppStorage, loadSampleResume, waitForThemesReady } from './helpers';

const ABOVE_THE_FOLD_BUDGET_PX = 100;

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
});

test.describe('mobile (iPhone 13)', () => {
  test.skip(({ isMobile }) => isMobile !== true, 'desktop project covered separately below');

  test('closed toolbar stays under the above-the-fold budget', async ({ page }) => {
    await loadSampleResume(page);
    await waitForThemesReady(page);

    const toolbar = page.locator('.studio__toolbar');
    await expect(toolbar).toBeVisible();

    const box = await toolbar.boundingBox();
    expect(box, 'toolbar must have a bounding box').not.toBeNull();
    expect.soft(box!.height).toBeLessThan(ABOVE_THE_FOLD_BUDGET_PX);
  });

  test('a More trigger is visible and controls a menu popup', async ({ page }) => {
    await loadSampleResume(page);
    await waitForThemesReady(page);

    const moreTrigger = page.getByRole('button', { name: /more toolbar actions/i });
    await expect(moreTrigger).toBeVisible();
    await expect(moreTrigger).toHaveAttribute('aria-haspopup', 'menu');
    await expect(moreTrigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('opening More reveals at least three of: Presets, Layout, Page-fit, Export, Settings', async ({
    page,
  }) => {
    await loadSampleResume(page);
    await waitForThemesReady(page);

    const moreTrigger = page.getByRole('button', { name: /more toolbar actions/i });
    await moreTrigger.click();
    await expect(moreTrigger).toHaveAttribute('aria-expanded', 'true');

    /* Each candidate is a real interactive control already in the toolbar;
       we look for them inside the toolbar after the drawer opens. The
       assertion is "≥ 3 of the 5 are now visible" — that's the floor the
       issue spec sets so this test doesn't bind to the exact roster which
       has shifted between #128 (Settings drawer) and #131 (mobile More). */
    const toolbar = page.locator('.studio__toolbar');
    const candidates = [
      // LayoutSelector root has class `layout-selector`.
      toolbar.locator('.layout-selector'),
      // PageFitIndicator's root carries `page-fit` (the indicator pill).
      toolbar.locator('.page-fit'),
      // The Export popover trigger is a labelled button.
      toolbar.getByRole('button', { name: /^export$/i }),
      // The Settings gear is a labelled icon button.
      toolbar.getByRole('button', { name: /open settings/i }),
    ];

    let visibleCount = 0;
    for (const candidate of candidates) {
      if (await candidate.first().isVisible()) visibleCount++;
    }
    // Floor of 3 of the 4 remaining secondary controls (#132 dropped Presets).
    expect(visibleCount).toBeGreaterThanOrEqual(3);
  });

  test('ThemePicker + Save-as-PDF stay visible without opening More', async ({ page }) => {
    await loadSampleResume(page);
    await waitForThemesReady(page);

    /* These are the two "always inline on mobile" controls per the issue
       spec. They are the highest-frequency actions and must not require
       a tap into the More menu. The picker's accessible name still
       starts with "theme " on mobile (the kicker is visually hidden but
       remains in the accessibility tree). */
    await expect(page.getByRole('button', { name: /^theme /i })).toBeVisible();
    await expect(page.getByRole('button', { name: /save as pdf/i })).toBeVisible();
  });

  test('Escape closes the drawer and restores focus to the More trigger', async ({ page }) => {
    await loadSampleResume(page);
    await waitForThemesReady(page);

    const moreTrigger = page.getByRole('button', { name: /more toolbar actions/i });
    await moreTrigger.click();
    await expect(moreTrigger).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('Escape');

    /* The button's accessible name flips when the drawer is open vs closed;
       after Escape we look for the closed-state label. */
    const reclosed = page.getByRole('button', { name: /more toolbar actions/i });
    await expect(reclosed).toHaveAttribute('aria-expanded', 'false');
    await expect(reclosed).toBeFocused();
  });
});

test.describe('desktop (1280×800)', () => {
  test.skip(({ isMobile }) => isMobile === true, 'desktop two-row layout invariants');

  test('the More trigger is hidden — inline toolbar is unchanged from #112', async ({ page }) => {
    await loadSampleResume(page);
    await waitForThemesReady(page);

    /* The More button exists in the DOM but is CSS-hidden on desktop. */
    const moreTrigger = page.locator('.studio__toolbar-more-trigger');
    await expect(moreTrigger).toHaveCount(1);
    await expect(moreTrigger).toBeHidden();

    /* And the controls that would otherwise live in the More drawer are
       all visible inline. (#132: Presets row removed — used to live here.) */
    const toolbar = page.locator('.studio__toolbar');
    await expect(toolbar.locator('.layout-selector')).toBeVisible();
    await expect(toolbar.locator('.page-fit')).toBeVisible();
    await expect(toolbar.getByRole('button', { name: /^export$/i })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: /open settings/i })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: /save as pdf/i })).toBeVisible();
  });
});

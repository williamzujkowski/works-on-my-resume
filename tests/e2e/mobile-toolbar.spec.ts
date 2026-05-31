/**
 * mobile-toolbar.spec.ts — mobile hamburger sheet invariants (#235).
 *
 * On phone-sized viewports the two-row toolbar wraps badly and consumes the
 * above-the-fold viewport before the resume preview is visible. PR 2 of #235
 * replaces the old in-toolbar "More" reflow drawer (#131) with a true modal:
 * the top bar shows ONLY a hamburger + the inline ThemePicker, and everything
 * else folds into the left-anchored MobileToolbarSheet (role=dialog) behind
 * the hamburger.
 *
 * Invariants locked in here:
 *
 *  1. At iPhone 13 (390×844): the closed toolbar's visible bounding-box
 *     height is < 100 px — the resume header is preserved above the fold.
 *  2. A hamburger (accessible name "More toolbar actions", aria-haspopup
 *     "dialog") is visible on mobile and only on mobile.
 *  3. Clicking it opens a role=dialog sheet, focus moves inside, and the
 *     sheet hosts the moved controls.
 *  4. Escape / scrim / close button all dismiss the sheet and restore focus
 *     to the hamburger.
 *  5. ThemePicker + Save-as-PDF: the picker stays inline (visible without
 *     opening the sheet); Save-as-PDF has MOVED inside the sheet.
 *  6. At 1280×800 the inline two-row toolbar (#112) is intact and the
 *     hamburger is absent.
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

  test('a hamburger is visible and controls a dialog', async ({ page }) => {
    await loadSampleResume(page);
    await waitForThemesReady(page);

    const hamburger = page.getByRole('button', { name: /more toolbar actions/i });
    await expect(hamburger).toBeVisible();
    // aria-haspopup is now "dialog" (#235): the hamburger opens a modal sheet,
    // not the old in-toolbar reflow drawer.
    await expect(hamburger).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(hamburger).toHaveAttribute('aria-expanded', 'false');
  });

  test('clicking the hamburger opens the sheet and moves focus into it', async ({ page }) => {
    await loadSampleResume(page);
    await waitForThemesReady(page);

    const hamburger = page.getByRole('button', { name: /more toolbar actions/i });
    await hamburger.click();
    await expect(hamburger).toHaveAttribute('aria-expanded', 'true');

    const sheet = page.getByRole('dialog', { name: /toolbar/i });
    await expect(sheet).toBeVisible();
    // Focus lands inside the sheet (on its Close button per the modal contract).
    const closeButton = sheet.getByRole('button', { name: /close toolbar menu/i });
    await expect(closeButton).toBeFocused();
  });

  test('the sheet hosts the moved toolbar controls', async ({ page }) => {
    await loadSampleResume(page);
    await waitForThemesReady(page);

    const hamburger = page.getByRole('button', { name: /more toolbar actions/i });
    await hamburger.click();
    const sheet = page.getByRole('dialog', { name: /toolbar/i });
    await expect(sheet).toBeVisible();

    /* The sheet should carry the bulk of the toolbar roster. Assert a FLOOR
       (≥ 6 of the candidates) rather than the exact set, so the test doesn't
       bind to incidental layout churn. Candidates span every group:
       Export (Save-as-PDF / Preview / Export), Page (Layout / Page-fit),
       Appearance (ChromeMode radios / theme-nav), More (Settings). */
    const candidates = [
      sheet.getByRole('button', { name: /save as pdf/i }),
      sheet.getByRole('button', { name: /^preview$/i }),
      sheet.getByRole('button', { name: /^export$/i }),
      sheet.locator('.layout-selector'),
      sheet.locator('.page-fit'),
      sheet.getByRole('radio', { name: /auto appearance/i }),
      sheet.getByRole('button', { name: /previous theme/i }),
      sheet.getByRole('button', { name: /random theme/i }),
      sheet.getByRole('button', { name: /open settings/i }),
    ];

    let visibleCount = 0;
    for (const candidate of candidates) {
      if (await candidate.first().isVisible()) visibleCount++;
    }
    expect(visibleCount).toBeGreaterThanOrEqual(6);
  });

  test('Save-as-PDF lives inside the sheet, not inline', async ({ page }) => {
    await loadSampleResume(page);
    await waitForThemesReady(page);

    // Closed top bar: Save-as-PDF is NOT inline (it moved into the sheet).
    await expect(page.getByRole('button', { name: /save as pdf/i })).toHaveCount(0);

    // Open the sheet — now it's present, inside the dialog.
    await page.getByRole('button', { name: /more toolbar actions/i }).click();
    const sheet = page.getByRole('dialog', { name: /toolbar/i });
    await expect(sheet.getByRole('button', { name: /save as pdf/i })).toBeVisible();
  });

  test('ThemePicker stays inline without opening the sheet', async ({ page }) => {
    await loadSampleResume(page);
    await waitForThemesReady(page);

    /* The picker is the one heavy control that stays in the top bar (it owns
       its own popover/revert state and must stay searchable). Its accessible
       name still starts with "theme " on mobile — the kicker is visually
       hidden but remains in the accessibility tree. */
    await expect(page.getByRole('button', { name: /^theme /i })).toBeVisible();
  });

  test('the close button dismisses the sheet and restores focus to the hamburger', async ({
    page,
  }) => {
    await loadSampleResume(page);
    await waitForThemesReady(page);

    const hamburger = page.getByRole('button', { name: /more toolbar actions/i });
    await hamburger.click();
    const sheet = page.getByRole('dialog', { name: /toolbar/i });
    await sheet.getByRole('button', { name: /close toolbar menu/i }).click();

    await expect(hamburger).toHaveAttribute('aria-expanded', 'false');
    await expect(hamburger).toBeFocused();
    await expect(page.getByRole('dialog', { name: /toolbar/i })).toHaveCount(0);
  });

  test('the scrim (click-outside) dismisses the sheet and restores focus', async ({ page }) => {
    await loadSampleResume(page);
    await waitForThemesReady(page);

    const hamburger = page.getByRole('button', { name: /more toolbar actions/i });
    await hamburger.click();
    await expect(page.getByRole('dialog', { name: /toolbar/i })).toBeVisible();

    // The overlay's onPointerDown dismisses only when the pointer lands on the
    // overlay ITSELF (not the sheet). Dispatch a pointerdown straight at the
    // overlay element so the test doesn't depend on the exact scrim-strip width.
    await page.locator('.mobile-sheet__overlay').dispatchEvent('pointerdown');

    await expect(hamburger).toHaveAttribute('aria-expanded', 'false');
    await expect(hamburger).toBeFocused();
  });

  test('Escape closes the sheet and restores focus to the hamburger', async ({ page }) => {
    await loadSampleResume(page);
    await waitForThemesReady(page);

    const hamburger = page.getByRole('button', { name: /more toolbar actions/i });
    await hamburger.click();
    await expect(hamburger).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('Escape');

    await expect(hamburger).toHaveAttribute('aria-expanded', 'false');
    await expect(hamburger).toBeFocused();
  });
});

test.describe('desktop (1280×800)', () => {
  test.skip(({ isMobile }) => isMobile === true, 'desktop two-row layout invariants');

  test('the hamburger is absent — inline toolbar is unchanged from #112', async ({ page }) => {
    await loadSampleResume(page);
    await waitForThemesReady(page);

    /* The hamburger is only rendered on the mobile path — on desktop it isn't
       in the DOM at all (the heavy controls live inline). */
    await expect(page.getByRole('button', { name: /more toolbar actions/i })).toHaveCount(0);
    await expect(page.locator('.studio__toolbar-hamburger')).toHaveCount(0);

    /* And the controls that fold into the sheet on mobile are all visible
       inline here. (#132: Presets row removed — used to live here.) */
    const toolbar = page.locator('.studio__toolbar');
    await expect(toolbar.locator('.layout-selector')).toBeVisible();
    await expect(toolbar.locator('.page-fit')).toBeVisible();
    await expect(toolbar.getByRole('button', { name: /^export$/i })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: /open settings/i })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: /save as pdf/i })).toBeVisible();
  });
});

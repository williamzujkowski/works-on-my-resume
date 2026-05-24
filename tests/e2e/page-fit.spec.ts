/**
 * page-fit.spec.ts — coverage for the page-fit indicator (#92).
 *
 * Asserts:
 *   - The toolbar pill appears once a resume is loaded, and shows a sensible
 *     label (either "Fits 1 page" or "Fit: N.N pages").
 *   - Clicking the pill opens a popover with a section breakdown and the
 *     "Approximate — based on screen rendering" hint.
 *   - Toggling the ruler checkbox mounts (and unmounts) the page-break
 *     overlay inside the preview pane.
 *   - Closing the popover via Esc returns focus to the pill.
 *
 * The estimate itself is approximate — we don't assert a specific page count,
 * only that the label matches one of the two known shapes.
 */
import { test, expect } from '@playwright/test';
import { clearAppStorage, loadSampleResume } from './helpers';

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
});

test('page-fit pill appears in Phase 2 and reports a page estimate', async ({ page }) => {
  await loadSampleResume(page);

  const pill = page.locator('.page-fit__pill');
  await expect(pill).toBeVisible();

  // Either "Fits 1 page" or "Fit: N.N pages" — the exact value depends on
  // viewport + fonts + theme, so match the shape rather than a literal.
  await expect(pill).toHaveText(/Fits 1 page|Fit: \d\.\d pages/);
});

test('clicking the pill opens a popover with section heights and the approximate-render hint', async ({
  page,
}) => {
  await loadSampleResume(page);

  await page.locator('.page-fit__pill').click();

  const popover = page.getByRole('dialog', { name: /page fit details/i });
  await expect(popover).toBeVisible();
  await expect(popover.getByText(/approximate — based on screen rendering/i)).toBeVisible();
  // The per-section list mounts whenever the preview has any `<h2>` —
  // the bundled sample resume has several.
  await expect(popover.getByText(/per-section share/i)).toBeVisible();
});

test('toggling the ruler shows then hides page-break lines on the preview', async ({ page }) => {
  await loadSampleResume(page);

  await page.locator('.page-fit__pill').click();
  const popover = page.getByRole('dialog', { name: /page fit details/i });

  // Ruler off by default — no overlay in the DOM.
  await expect(page.locator('.page-fit-ruler')).toHaveCount(0);

  // The ruler-toggle row can sit below the viewport on the mobile project
  // (the popover is taller than 200px). Scroll it into view before
  // clicking; `.check()` reports "element outside viewport" otherwise.
  const rulerToggle = popover.getByLabel(/show page-break ruler/i);
  await rulerToggle.scrollIntoViewIfNeeded();
  await rulerToggle.check();

  // Overlay appears in the preview pane. The sample resume is short enough
  // that it may fit a single page (zero ruler lines), so we assert the
  // overlay's PRESENCE rather than the line count — the toggle wiring is
  // what matters here.
  await expect(page.locator('.page-fit-ruler')).toHaveCount(1);

  await rulerToggle.uncheck();
  await expect(page.locator('.page-fit-ruler')).toHaveCount(0);
});

test('pressing Escape closes the popover and returns focus to the pill', async ({ page }) => {
  await loadSampleResume(page);

  const pill = page.locator('.page-fit__pill');
  await pill.click();

  const popover = page.getByRole('dialog', { name: /page fit details/i });
  await expect(popover).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);

  // Focus is back on the pill so keyboard users aren't stranded.
  await expect(pill).toBeFocused();
});

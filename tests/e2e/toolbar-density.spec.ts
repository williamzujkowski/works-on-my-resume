/**
 * toolbar-density.spec.ts — toolbar layout invariants (#112).
 *
 * After #91, #92, #94, #98, #99, #101 the studio toolbar had grown to
 * three wrapped rows on common desktop widths. This file locks in the
 * #112 reshape:
 *
 *   1. At 1280×800 the toolbar fits on TWO rows max.
 *   2. The WCAG conformance badge lives in the preview pane header only —
 *      not in the toolbar.
 *   3. With zero snapshots saved, the labelled "Snapshots (0)" pill is
 *      collapsed to an icon-only "Save snapshot" trigger.
 *   4. The toolbar keyboard shortcuts (← / → / r for theme stepping)
 *      still work — the reshape didn't break the global keydown wiring.
 *
 * Mobile is covered indirectly: the toolbar still uses flex-wrap, so the
 * row-break element collapses harmlessly into the natural wrap on narrow
 * viewports. The mobile-iphone-13 project re-runs the suite to confirm
 * nothing crashes; the desktop assertions here are skipped on mobile
 * because the row-count signal doesn't translate.
 */
import { test, expect } from '@playwright/test';
import {
  clearAppStorage,
  loadSampleResume,
  openSettingsDrawer,
  waitForThemesReady,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
});

test('at 1280×800 the toolbar lays out as two rows, not three', async ({ page, isMobile }) => {
  test.skip(isMobile === true, 'two-row invariant is a desktop concern (mobile wraps further)');

  await loadSampleResume(page);
  await waitForThemesReady(page);

  /* Cluster the toolbar's first-level children by their `offsetTop`. Each
     cluster is one wrapped row; the number of distinct `offsetTop` values
     equals the number of rows. We bucket within a small tolerance so two
     children whose vertical centers differ by a single pixel still cluster
     together. The row-break element is included in the children walk so a
     missing CSS rule would surface as an extra cluster. */
  const rowCount = await page.evaluate(() => {
    const toolbar = document.querySelector('.studio__toolbar');
    if (!toolbar) return -1;
    const tops: number[] = [];
    for (const child of Array.from(toolbar.children)) {
      const el = child as HTMLElement;
      // Skip elements that have no rendered height — popovers, the
      // row-break itself — they don't contribute to row count.
      if (el.offsetHeight === 0) continue;
      tops.push(el.offsetTop);
    }
    // Bucket within ±4px. Different controls have slightly different
    // heights, so the exact pixel may shift by a row of padding.
    const buckets: number[] = [];
    for (const t of tops) {
      const hit = buckets.find((b) => Math.abs(b - t) <= 4);
      if (hit === undefined) buckets.push(t);
    }
    return buckets.length;
  });

  expect(rowCount).toBeGreaterThan(0);
  expect(rowCount).toBeLessThanOrEqual(2);
});

test('the WCAG badge lives in the preview pane header, not in the toolbar', async ({ page }) => {
  await loadSampleResume(page);
  await waitForThemesReady(page);

  /* Preview header carries the canonical WCAG badge (#88). It has the
     `studio__pane-wcag` class with a level modifier — at least one match
     should exist inside `.studio__pane-header`. */
  const headerBadge = page.locator('.studio__pane-header .studio__pane-wcag');
  await expect(headerBadge).toHaveCount(1);

  /* The toolbar must NOT contain the duplicate `theme-controls__current`
     chip cluster from before #112, and must not carry any `.studio__pane-wcag`
     element (the badge class) either. */
  const toolbarChips = page.locator('.studio__toolbar .theme-controls__current');
  await expect(toolbarChips).toHaveCount(0);
  const toolbarWcag = page.locator('.studio__toolbar .studio__pane-wcag');
  await expect(toolbarWcag).toHaveCount(0);
});

test('with zero snapshots, Snapshots (0) is not in the DOM — only the icon-only trigger', async ({
  page,
}) => {
  await loadSampleResume(page);

  // #128: Snapshots live inside the Settings drawer. Open it so the
  // zero-state trigger is reachable.
  await openSettingsDrawer(page);

  /* No snapshots have been saved (the gate is OFF by default in tests),
     so the trigger must NOT read as "Snapshots (0)". The icon-only
     "Save snapshot" trigger is the new zero-state affordance. With the
     privacy gate off, its accessible name carries the explanatory hint
     after the label — match by prefix rather than exact equality. */
  await expect(page.getByRole('button', { name: /Snapshots \(0\)/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Save snapshot/ })).toBeVisible();
});

test('arrow keys still cycle themes after the toolbar reshape', async ({ page }) => {
  /* Drive the toolbar via the keyboard, end-to-end. If the reshape
     accidentally broke the global keydown handler (e.g. by moving the
     theme controls inside a wrapper that intercepts events), this would
     surface as a no-op `--resume-bg`. */
  await page.goto('?theme=dracula');
  await loadSampleResume(page);
  await waitForThemesReady(page);
  await expect(page.locator('.theme-picker__trigger-name').first()).toHaveText('Dracula');

  // Park focus on a non-editable focusable element so global shortcuts fire.
  // #128: the Random theme button moved into the Settings drawer; the
  // Save-as-PDF button is a stable, always-visible non-editable toolbar
  // anchor that serves the same purpose here.
  await page.getByRole('button', { name: /^save as pdf$/i }).focus();

  const before = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--resume-bg').trim(),
  );

  await page.keyboard.press('ArrowRight');
  // Allow the 350ms arrow-commit debounce to flush.
  await expect
    .poll(
      async () =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--resume-bg').trim(),
        ),
      { timeout: 3_000 },
    )
    .not.toBe(before);

  // And `r` triggers a random theme — another single-key shortcut path.
  const afterArrow = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--resume-bg').trim(),
  );
  await page.keyboard.press('r');
  await expect
    .poll(
      async () =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--resume-bg').trim(),
        ),
      { timeout: 3_000 },
    )
    .not.toBe(afterArrow);
});

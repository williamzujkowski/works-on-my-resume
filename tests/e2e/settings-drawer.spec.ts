/**
 * settings-drawer.spec.ts — the right-anchored Settings drawer (#128).
 *
 * The drawer consolidates four pieces of UI that used to live as separate
 * toolbar islands:
 *   - ATS preview toggle (#31)
 *   - Resume version snapshots dropdown (#94)
 *   - Single-keyboard-shortcut help affordance (#99)
 *   - Keyboard-shortcuts help icon (#58)
 *
 * The trigger is the gear icon at the rightmost slot of toolbar Row 2.
 * Behavior under test:
 *   1. The gear opens the drawer; the drawer mounts the four documented
 *      section groups (Workspace / Snapshots / Theme nav / Help) and the
 *      controls that were absorbed are reachable inside.
 *   2. Escape closes the drawer; focus returns to the gear.
 *   3. Click-outside closes the drawer.
 */
import { test, expect } from '@playwright/test';
import {
  clearAppStorage,
  loadSampleResume,
  openSettingsDrawer,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
  await loadSampleResume(page);
});

test('the gear opens a drawer with the four documented section groups', async ({ page }) => {
  await openSettingsDrawer(page);

  const drawer = page.getByRole('dialog', { name: /^settings$/i });

  // The four group headings — small-caps kickers via .section-kicker.
  await expect(drawer.getByRole('heading', { name: /^workspace$/i })).toBeVisible();
  await expect(drawer.getByRole('heading', { name: /^snapshots$/i })).toBeVisible();
  await expect(drawer.getByRole('heading', { name: /^theme nav$/i })).toBeVisible();
  await expect(drawer.getByRole('heading', { name: /^help$/i })).toBeVisible();

  // ATS toggle reachable inside (role=switch, the contract the old
  // toolbar AtsModeToggle exposed).
  await expect(drawer.getByRole('switch', { name: /ats preview/i })).toBeVisible();

  // Snapshots affordance present (gated off by default — disabled trigger
  // reads as "Save snapshot" with the privacy hint in its aria-label).
  await expect(drawer.getByRole('button', { name: /save snapshot/i })).toBeVisible();

  // Theme nav buttons are reachable from the drawer.
  await expect(drawer.getByRole('button', { name: /previous theme/i })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /next theme/i })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /random theme/i })).toBeVisible();

  // The shortcut legend lives in the Help group as a list of <kbd> rows.
  await expect(drawer.getByText(/previous \/ next theme/i)).toBeVisible();
  await expect(drawer.getByText(/random theme/i).first()).toBeVisible();

  // The full-keyboard-help dialog is still reachable from inside the drawer.
  await expect(
    drawer.getByRole('button', { name: /open the full shortcuts dialog/i }),
  ).toBeVisible();
});

test('Escape closes the drawer and restores focus to the gear button', async ({ page }) => {
  await openSettingsDrawer(page);
  const drawer = page.getByRole('dialog', { name: /^settings$/i });
  await expect(drawer).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  // Focus returns to the gear button — keyboard users land where they
  // opened it from.
  await expect(page.getByRole('button', { name: /open settings/i })).toBeFocused();
});

test('click-outside the drawer dismisses it', async ({ page }) => {
  await openSettingsDrawer(page);
  const drawer = page.getByRole('dialog', { name: /^settings$/i });
  await expect(drawer).toBeVisible();

  // Click on the overlay (outside the drawer pane). The drawer pane sits
  // on the right edge; clicking the leftmost edge of the overlay is a
  // safe click-outside target.
  await page.locator('.settings-drawer__overlay').click({ position: { x: 10, y: 200 } });
  await expect(drawer).toHaveCount(0);
});

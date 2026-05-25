/**
 * empty-state-hero.spec.ts — the Phase 1 hero block (#127).
 *
 * Phase 1 lands a loud, OKLCH-inspired landing hero above the workbench:
 *   - Title (`Works on My Resume`) at display size.
 *   - Tagline with inline keyboard chips (the discoverable shortcuts).
 *   - Stat counter row — THEMES / LAYOUTS / TEMPLATES / OFFLINE-READY.
 *
 * Once a resume is loaded, the hero collapses to the static AppHeader
 * chrome (no double-render of the brand row). This spec validates that
 * round-trip end-to-end.
 */
import { test, expect } from '@playwright/test';
import { clearAppStorage, loadSampleResume } from './helpers';

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
});

test('the hero is rendered on Phase 1 with title, kbd-chip tagline, and stat counters', async ({
  page,
}) => {
  const hero = page.locator('.app-hero');
  await expect(hero).toBeVisible();

  // The title carries the brand name at display size.
  await expect(hero.getByRole('heading', { name: /works on my resume/i })).toBeVisible();

  // The tagline carries inline <kbd> chips for the headline shortcuts.
  // Match the actual chip elements so a future copy tweak that loses the
  // chips would fail this assertion.
  const heroKbds = hero.locator('kbd');
  // We render four kbd chips: ←, →, /, r.
  await expect(heroKbds).toHaveCount(4);

  // The stat counters: each documented label must be present in the
  // stat-label region. The tagline above also mentions "themes" and
  // "layouts", so scope strictly to the .app-hero__stat-label nodes.
  const statLabels = hero.locator('.app-hero__stat-label');
  await expect(statLabels.filter({ hasText: /^themes$/i })).toBeVisible();
  await expect(statLabels.filter({ hasText: /^layouts$/i })).toBeVisible();
  await expect(statLabels.filter({ hasText: /^templates$/i })).toBeVisible();
  await expect(statLabels.filter({ hasText: /^offline-ready$/i })).toBeVisible();

  // While the hero is up, the static AppHeader chrome is hidden via the
  // body[data-app-phase='hero'] CSS rule.
  await expect(page.locator('.app-header')).toBeHidden();
});

test('loading a resume collapses the hero — the static AppHeader returns', async ({ page }) => {
  // Baseline: hero present.
  await expect(page.locator('.app-hero')).toHaveCount(1);

  // Load the bundled sample, which transitions to Phase 2.
  await loadSampleResume(page);

  // Hero is gone — no double-render of the brand row.
  await expect(page.locator('.app-hero')).toHaveCount(0);

  // The static AppHeader is now the brand surface again.
  await expect(page.locator('.app-header')).toBeVisible();
});

test('the body-level data-app-phase attribute flips on load + unload', async ({ page }) => {
  // Phase 1 → data-app-phase='hero'.
  await expect(page.locator('body')).toHaveAttribute('data-app-phase', 'hero');

  await loadSampleResume(page);

  // Phase 2 → data-app-phase='workbench'.
  await expect(page.locator('body')).toHaveAttribute('data-app-phase', 'workbench');
});

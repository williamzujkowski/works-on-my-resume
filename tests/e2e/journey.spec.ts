/**
 * journey.spec.ts — the Phase 1 → Phase 2 flow.
 *
 * Validates the two-phase journey called out in ResumeStudio's docs:
 *   - Phase 1 (no resume loaded): uploader is the hero, the theme toolbar
 *     and shortcut legend are NOT in the DOM.
 *   - Phase 2 (resume loaded): the toolbar and legend appear, the resume
 *     is rendered.
 *   - Clear: returns to Phase 1.
 */
import { test, expect } from '@playwright/test';
import { clearAppStorage, loadSampleResume } from './helpers';

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
});

test('phase 1: toolbar and shortcut legend are absent until a resume is loaded', async ({
  page,
}) => {
  // The empty-state preview is the giveaway that we are in Phase 1.
  await expect(page.getByText(/no resume loaded yet/i)).toBeVisible();

  // The theme picker trigger and Export button live in the Phase 2 toolbar.
  await expect(page.getByRole('button', { name: /^theme /i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^export$/i })).toHaveCount(0);

  // The shortcut legend's label is the simplest stable signal.
  await expect(page.getByText('Shortcuts', { exact: true })).toHaveCount(0);

  // The uploader's hero affordance — "Load sample" and "Choose file" — IS present.
  await expect(page.getByRole('button', { name: /load sample/i })).toBeVisible();
});

test('phase 2: loading the sample reveals the toolbar, legend, and rendered resume', async ({
  page,
}) => {
  await loadSampleResume(page);

  // Rendered resume content — scope "Avery Quinn" to the preview article,
  // since the same string also appears in the editor textarea.
  const article = page.getByRole('article', { name: /rendered resume/i });
  await expect(article).toBeVisible();
  await expect(article.getByText('Avery Quinn')).toBeVisible();

  // Toolbar now mounted.
  await expect(page.getByRole('button', { name: /^theme /i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^export$/i })).toBeVisible();

  // Shortcut legend now mounted.
  await expect(page.getByText('Shortcuts', { exact: true })).toBeVisible();
});

test('clear: returns to the empty Phase 1 state', async ({ page }) => {
  await loadSampleResume(page);

  await page.getByRole('button', { name: /^clear$/i }).click();

  // Empty-state preview restored.
  await expect(page.getByText(/no resume loaded yet/i)).toBeVisible();
  // The preview article no longer exists, and the editor textarea is cleared.
  await expect(page.getByRole('article', { name: /rendered resume/i })).toHaveCount(0);
  await expect(page.getByLabel(/markdown source/i)).toHaveValue('');

  // Toolbar + legend gone.
  await expect(page.getByRole('button', { name: /^theme /i })).toHaveCount(0);
  await expect(page.getByText('Shortcuts', { exact: true })).toHaveCount(0);
});

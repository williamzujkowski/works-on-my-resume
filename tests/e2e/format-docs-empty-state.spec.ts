/**
 * format-docs-empty-state.spec.ts — the Markdown-format reference is
 * reachable from the empty state (#198).
 *
 * Before #198 the reference lived only behind the Settings gear, which
 * appears after a resume is loaded — so a brand-new writer who needs the
 * frontmatter/section contract couldn't find it. The hero now carries a
 * link that opens the same dialog, with focus returning to the link on
 * close.
 */
import { test, expect } from '@playwright/test';
import { clearAppStorage, loadSampleResume } from './helpers';

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
});

test('empty state exposes the Markdown format reference and restores focus on close', async ({
  page,
}) => {
  const trigger = page.getByRole('button', { name: /markdown format reference/i });
  await expect(trigger).toBeVisible();

  await trigger.click();
  const dialog = page.getByRole('dialog', { name: /markdown format/i });
  await expect(dialog).toBeVisible();

  // Esc closes the dialog and returns focus to the hero link (not lost to
  // <body>), so a keyboard user keeps their place.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('the hero format link is gone once a resume is loaded (Phase 2)', async ({ page }) => {
  await expect(page.getByRole('button', { name: /markdown format reference/i })).toBeVisible();
  await loadSampleResume(page);
  // The hero unmounts in Phase 2 — the link must not leak into the workbench
  // (the format reference is reachable via Settings there instead).
  await expect(page.getByRole('button', { name: /markdown format reference/i })).toHaveCount(0);
});

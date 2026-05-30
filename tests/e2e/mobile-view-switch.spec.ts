/**
 * mobile-view-switch.spec.ts — the sticky Edit/Preview switch (#220).
 *
 * On the stacked (single-column) layout the editor accordion and the
 * preview share one column, so a one-tap switch lets the user jump between
 * editing and previewing without hunting for the accordion summary. It's a
 * view toggle (aria-pressed), reuses `editorOpen`, and is hidden on the
 * side-by-side desktop layout.
 */
import { test, expect } from '@playwright/test';
import { clearAppStorage, loadSampleResume } from './helpers';

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
});

test('switch jumps between editor and preview (stacked layout)', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'mobile-iphone-13',
    'the switch only shows on the stacked (≤960px) layout',
  );

  await loadSampleResume(page);

  const group = page.getByRole('group', { name: /editor and preview/i });
  await expect(group).toBeVisible();
  const editBtn = group.getByRole('button', { name: 'Edit' });
  const previewBtn = group.getByRole('button', { name: 'Preview' });

  // After load the accordion is collapsed → Preview is the active view.
  await expect(previewBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(editBtn).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByLabel(/markdown source/i)).not.toBeVisible();

  // Tap Edit → the editor opens and the textarea is reachable.
  await editBtn.click();
  await expect(editBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('details.studio__pane--editor')).toHaveAttribute('open', /.*/);
  await expect(page.getByLabel(/markdown source/i)).toBeVisible();

  // Tap Preview → the editor collapses again.
  await previewBtn.click();
  await expect(previewBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('details.studio__pane--editor')).not.toHaveAttribute('open', /.*/);
});

test('switch is hidden on the side-by-side desktop layout', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'desktop layout check');
  await loadSampleResume(page);
  // The element is rendered (so the markup is shared) but CSS-hidden ≥961px.
  await expect(page.getByRole('group', { name: /editor and preview/i })).toBeHidden();
});

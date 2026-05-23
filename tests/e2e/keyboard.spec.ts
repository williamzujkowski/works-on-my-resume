/**
 * keyboard.spec.ts — global keyboard shortcuts.
 *
 * Covers:
 *  - `?` opens the keyboard-shortcuts help dialog.
 *  - Escape closes the dialog and restores focus to the trigger.
 *  - With single-key shortcuts disabled, `r` does NOT shuffle the theme.
 *  - With shortcuts enabled, arrow keys change the theme — but only when
 *    focus is outside an editable field (typing in the editor must not
 *    trigger theme nav).
 *
 * Notes: shortcuts are gated on `hasResume`, so each scenario first loads
 * the sample. Storage is cleared between tests so the shortcuts-enabled
 * preference starts at its default (true).
 */
import { test, expect } from '@playwright/test';
import { clearAppStorage, loadSampleResume } from './helpers';

/** Read the document-level CSS var so a "theme changed" assertion is honest. */
async function readBgVar(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--resume-bg').trim(),
  );
}

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
  await loadSampleResume(page);
  // Move focus to the document body via the skip-link sink — body is
  // non-editable, so global shortcuts are eligible to fire and the keydown's
  // `event.target` is not a button that might intercept Escape itself.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
});

test('? opens the help dialog, Escape closes it and restores focus to the help trigger', async ({
  page,
}) => {
  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: /keyboard shortcuts/i });
  await expect(dialog).toBeVisible();
  // The Close button starts focused inside the dialog.
  await expect(page.getByRole('button', { name: /close keyboard shortcuts/i })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // ResumeStudio restores focus to its `helpTriggerRef` — the icon-only
  // "Keyboard shortcuts" button in the toolbar — on close. That is the
  // documented contract regardless of who pressed `?`.
  await expect(page.getByRole('button', { name: 'Keyboard shortcuts' })).toBeFocused();
});

test('with single-key shortcuts disabled, r does NOT shuffle the theme', async ({ page }) => {
  // Open the help dialog, uncheck the master toggle, close.
  await page.getByRole('button', { name: /all shortcuts/i }).click();
  await page.getByRole('checkbox', { name: /single-key shortcuts enabled/i }).uncheck();
  await page.keyboard.press('Escape');

  // Confirm the legend reflects the off state — discoverable signal #1.
  await expect(page.getByText(/single-key shortcuts are off/i)).toBeVisible();

  const before = await readBgVar(page);

  // Press `r` repeatedly to give a flaky theme-shuffle every chance to land.
  // The active element should NOT be editable here (we focused the article).
  await page.keyboard.press('r');
  await page.keyboard.press('r');
  await page.keyboard.press('r');

  const after = await readBgVar(page);
  expect(after).toBe(before);
});

test('arrow keys shuffle the theme when shortcuts are enabled and focus is non-editable', async ({
  page,
}) => {
  // Sanity: shortcuts should be on by default.
  await expect(page.getByText(/single-key shortcuts are off/i)).toHaveCount(0);

  /* Pick a deterministic starting theme so we know the "next" theme will
     have a visibly different background. dracula sits in a dark cluster
     of the dataset; stepping forward lands on something different. */
  await page.goto('?theme=dracula');
  await loadSampleResume(page);
  await expect(page.locator('.theme-picker__trigger-name').first()).toHaveText('Dracula');

  // Park focus on a non-editable, focusable element so `event.target` in the
  // global keydown handler is definitely outside any text field.
  await page.getByRole('button', { name: /random theme/i }).focus();

  const beforeName = await page.locator('.theme-picker__trigger-name').first().textContent();
  const beforeBg = await readBgVar(page);

  await page.keyboard.press('ArrowRight');

  // Assert against the trigger name (the most direct evidence the theme
  // changed) — and keep the CSS-var check as a secondary signal.
  await expect
    .poll(async () => page.locator('.theme-picker__trigger-name').first().textContent())
    .not.toBe(beforeName);
  expect(await readBgVar(page)).not.toBe(beforeBg);
});

test('arrow keys do NOT shuffle the theme when focus is in the editor', async ({ page }) => {
  const before = await readBgVar(page);
  // Park focus in the Markdown source textarea.
  await page.getByLabel(/markdown source/i).click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const after = await readBgVar(page);
  expect(after).toBe(before);
});

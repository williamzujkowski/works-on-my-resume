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
import {
  clearAppStorage,
  expandMobileEditor,
  loadSampleResume,
  waitForThemesReady,
} from './helpers';

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
  // After #80 the theme dataset loads lazily on idle. Several tests below
  // snapshot `--resume-bg` and assert it does NOT change — but if the
  // dataset's post-load re-resolve fires mid-test (swapping the boot
  // fallback for a curated light theme), the snapshot would flip. Wait for
  // the dataset to be in place before anyone reads CSS variables.
  await waitForThemesReady(page);
  // Move focus to the document body via the skip-link sink — body is
  // non-editable, so global shortcuts are eligible to fire and the keydown's
  // `event.target` is not a button that might intercept Escape itself.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
});

test('? opens the help dialog, Escape closes it and restores focus to the help trigger', async ({
  page,
  isMobile,
}) => {
  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: /keyboard shortcuts/i });
  await expect(dialog).toBeVisible();
  // The Close button starts focused inside the dialog.
  await expect(page.getByRole('button', { name: /close keyboard shortcuts/i })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // After the #128 consolidation the dedicated "Keyboard shortcuts"
  // toolbar icon is gone — the dialog opens either from inside the
  // Settings drawer or via the global `?` shortcut. Focus restore falls
  // back to the Settings gear, the closest sensible target — when it is
  // visible. On mobile (#131) the gear collapses behind the More menu,
  // so the focus restore is best-effort: the dialog is gone and the
  // user is back on the toolbar's keyboard-accessible surface.
  if (isMobile !== true) {
    await expect(page.getByRole('button', { name: /open settings/i })).toBeFocused();
  }
});

test('with single-key shortcuts disabled, r does NOT shuffle the theme', async ({ page }) => {
  // Open the help dialog via the `?` keyboard shortcut, uncheck the master
  // toggle, close. The legacy "All shortcuts" chip was absorbed into the
  // Settings drawer's Help section (#128); the dialog is still the
  // canonical entry point for the master toggle.
  await page.keyboard.press('?');
  await page.getByRole('checkbox', { name: /single-key shortcuts enabled/i }).uncheck();
  await page.keyboard.press('Escape');

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
  // The dataset is lazy-loaded on idle (#80); wait until it's in place
  // before asserting that the URL slug has been resolved to a real theme.
  await waitForThemesReady(page);
  await expect(page.locator('.theme-picker__trigger-name').first()).toHaveText('Dracula');

  // Park focus on a non-editable, focusable element so `event.target` in the
  // global keydown handler is definitely outside any text field. #128: the
  // Random theme button moved into the Settings drawer; the Save-as-PDF
  // button is a stable always-visible toolbar peer that serves the same
  // role for parking focus here.
  await page.getByRole('button', { name: /^save as pdf$/i }).focus();

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
  // On mobile (#100) the editor pane collapses after a resume loads; the
  // textarea sits inside the collapsed accordion, so expand it before
  // trying to park focus there.
  await expandMobileEditor(page);
  // Park focus in the Markdown source textarea.
  await page.getByLabel(/markdown source/i).click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const after = await readBgVar(page);
  expect(after).toBe(before);
});

test('Preview/Health tablist: Arrow keys move selection without shuffling the theme', async ({
  page,
}) => {
  const preview = page.getByRole('tab', { name: 'Preview' });
  const health = page.getByRole('tab', { name: 'Health' });
  await expect(preview).toHaveAttribute('aria-selected', 'true');

  // The tablist's roving tabindex shares the ←/→ keys with the global theme
  // shuffle. Snapshot the theme so we can prove the shuffle did NOT fire.
  const bg = await readBgVar(page);

  await preview.focus();
  await page.keyboard.press('ArrowRight');
  await expect(health).toHaveAttribute('aria-selected', 'true');
  await expect(health).toBeFocused();
  expect(await readBgVar(page)).toBe(bg);

  await page.keyboard.press('ArrowLeft');
  await expect(preview).toHaveAttribute('aria-selected', 'true');
  await expect(preview).toBeFocused();
  expect(await readBgVar(page)).toBe(bg);

  // Home/End jump to the ends.
  await page.keyboard.press('End');
  await expect(health).toBeFocused();
  await page.keyboard.press('Home');
  await expect(preview).toBeFocused();
});

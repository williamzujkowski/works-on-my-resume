/**
 * editor.spec.ts — Markdown editor quality-of-life features.
 *
 * Covers:
 *  - The line-number gutter is mounted.
 *  - The soft-wrap toggle flips the textarea's `wrap` attribute.
 *  - "Insert section" inserts the corresponding snippet at the caret.
 *  - After a resume is loaded, the uploader collapses to its one-line bar.
 */
import { test, expect } from '@playwright/test';
import { clearAppStorage, loadSampleResume } from './helpers';

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
});

test('the line-number gutter is present and matches the current line count', async ({ page }) => {
  // Populate a known three-line document directly via the editor.
  await page.getByLabel(/markdown source/i).fill('line one\nline two\nline three');

  /* The gutter renders one `<span class="editor__gutter-line">` per line.
     We confirm it exists, is non-empty, and counts up correctly. */
  const gutterLines = page.locator('.editor__gutter .editor__gutter-line');
  await expect(gutterLines).toHaveCount(3);
  await expect(gutterLines.nth(0)).toHaveText('1');
  await expect(gutterLines.nth(2)).toHaveText('3');
});

test('soft-wrap toggle flips the textarea wrap attribute', async ({ page }) => {
  const textarea = page.getByLabel(/markdown source/i);
  // Default is wrapped (soft).
  await expect(textarea).toHaveAttribute('wrap', 'soft');

  await page.getByRole('button', { name: /wrap/i }).click();
  await expect(textarea).toHaveAttribute('wrap', 'off');

  await page.getByRole('button', { name: /wrap/i }).click();
  await expect(textarea).toHaveAttribute('wrap', 'soft');
});

test('Insert section appends an Experience entry skeleton', async ({ page }) => {
  // Start from an empty document so "before" is unambiguous.
  const textarea = page.getByLabel(/markdown source/i);
  await textarea.fill('');
  // Focus so the caret position is `0`.
  await textarea.click();

  /* Experience is one of the always-visible quick-insert buttons on wide
     viewports (#70), but on narrow viewports the row collapses and it's
     reachable through the popover instead. Pick whichever entry point is
     actually visible — the inserted snippet is identical either way. */
  const quickExperience = page.getByRole('button', { name: /^insert experience entry$/i });
  if (await quickExperience.isVisible()) {
    await quickExperience.click();
  } else {
    await page.getByRole('button', { name: /^insert section$/i }).click();
    await page.getByRole('menuitem', { name: /experience entry/i }).click();
  }

  const value = await textarea.inputValue();
  // The snippet must include the canonical placeholder heading and a bullet.
  expect(value).toContain('Job Title — Company Name');
  expect(value).toMatch(/^\s*###\s+Job Title/);
});

test('after loading a resume the uploader collapses to its compact bar', async ({ page }) => {
  // Phase 1: dropzone is the hero. The "Drop a Markdown file here" copy is its giveaway.
  await expect(page.getByText(/drop a markdown file here/i)).toBeVisible();

  await loadSampleResume(page);

  // Phase 2: that dropzone copy is gone. The compact bar shows the file name + line count.
  await expect(page.getByText(/drop a markdown file here/i)).toHaveCount(0);
  // The filename appears in two places — the studio pane-tab and the
  // uploader's compact bar; we only care that the compact bar is now mounted.
  await expect(page.locator('.uploader__loaded-name')).toHaveText('sample-resume.md');
  await expect(page.locator('.uploader__loaded-lines')).toContainText(/lines?/);
  // And the Clear button is mounted (Phase 2 affordance).
  await expect(page.getByRole('button', { name: /^clear$/i })).toBeVisible();
});

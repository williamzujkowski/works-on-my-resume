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
  // Note: empty-doc auto-prepend (#97) leads with the frontmatter block, so
  // the Experience heading lands AFTER `---\n…\n---` rather than at offset 0.
  expect(value).toContain('Job Title — Company Name');
  expect(value).toMatch(/###\s+Job Title/);
});

test('picking any snippet on an empty editor auto-prepends frontmatter (#97)', async ({ page }) => {
  // Start from an empty document — the auto-prepend trigger is "value is empty
  // AND no existing frontmatter". With no value at all both conditions hold.
  const textarea = page.getByLabel(/markdown source/i);
  await textarea.fill('');
  await textarea.click();

  // Pick a non-frontmatter snippet. Experience is reachable either via the
  // quick-insert button (wide viewports) or the popover (narrow viewports).
  const quickExperience = page.getByRole('button', { name: /^insert experience entry$/i });
  if (await quickExperience.isVisible()) {
    await quickExperience.click();
  } else {
    await page.getByRole('button', { name: /^insert section$/i }).click();
    await page.getByRole('menuitem', { name: /experience entry/i }).click();
  }

  const value = await textarea.inputValue();
  // Frontmatter must lead the document, with the canonical identity keys,
  // and the Experience snippet must follow.
  expect(value).toMatch(/^---\n/);
  expect(value).toContain('name: Your Name');
  expect(value).toContain('role: Your Role');
  expect(value).toMatch(/---\n[\s\S]*###\s+Job Title/);
});

test('picking the frontmatter snippet itself does not double up (#97)', async ({ page }) => {
  // Empty document → pick Frontmatter directly. It lives in the popover only.
  const textarea = page.getByLabel(/markdown source/i);
  await textarea.fill('');
  await textarea.click();

  await page.getByRole('button', { name: /^insert section$/i }).click();
  await page.getByRole('menuitem', { name: /frontmatter \(identity header\)/i }).click();

  const value = await textarea.inputValue();
  // The frontmatter block opens the document exactly once.
  expect(value).toMatch(/^---\n/);
  const fences = value.match(/^---\s*$/gm) ?? [];
  // Opening + closing fence — two `---` lines, not four.
  expect(fences).toHaveLength(2);
});

test('snippets do not prepend frontmatter when content already exists (#97)', async ({ page }) => {
  // Non-empty editor → the auto-prepend trigger must NOT fire, even when no
  // `---` is present, because the empty-document precondition is unmet.
  const textarea = page.getByLabel(/markdown source/i);
  await textarea.fill('# Existing heading\n\nSome body text.\n');
  await textarea.click();

  const quickExperience = page.getByRole('button', { name: /^insert experience entry$/i });
  if (await quickExperience.isVisible()) {
    await quickExperience.click();
  } else {
    await page.getByRole('button', { name: /^insert section$/i }).click();
    await page.getByRole('menuitem', { name: /experience entry/i }).click();
  }

  const value = await textarea.inputValue();
  // No frontmatter was injected — the document still opens with the heading.
  expect(value.startsWith('# Existing heading')).toBe(true);
  expect(value).not.toContain('name: Your Name');
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

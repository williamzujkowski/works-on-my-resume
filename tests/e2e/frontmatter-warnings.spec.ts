/**
 * frontmatter-warnings.spec.ts — friendly parser warnings.
 *
 * The Markdown parser surfaces non-blocking warnings for typo'd frontmatter
 * keys, malformed scalars (e.g. an `email` with no @), and malformed link
 * entries. The terse `{ GitHub: "https://…" }` single-pair link form is
 * explicitly OK and must NOT trip the "missing label" branch.
 */
import { test, expect } from '@playwright/test';
import { clearAppStorage } from './helpers';

/** Paste arbitrary Markdown into the editor, replacing whatever is there. */
async function pasteMarkdown(
  page: import('@playwright/test').Page,
  markdown: string,
): Promise<void> {
  const editor = page.getByLabel(/markdown source/i);
  await editor.fill(markdown);
  // The parser is debounced 200 ms — wait until the warnings block (or the
  // preview body) has updated for the new content.
  await expect(page.getByRole('article', { name: /rendered resume/i })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
});

test('typo`d frontmatter key surfaces a "did you mean" warning', async ({ page }) => {
  const md = [
    '---',
    'naem: Avery Quinn',
    'role: Senior Platform Engineer',
    '---',
    '',
    '## Summary',
    '',
    'Body text so the preview renders.',
    '',
  ].join('\n');

  await pasteMarkdown(page, md);

  // The warnings block is `<div class="preview-warnings" role="status">`.
  const warnings = page.locator('.preview-warnings');
  await expect(warnings).toBeVisible();
  await expect(warnings).toContainText('"naem"');
  await expect(warnings).toContainText('did you mean "name"');
});

test('malformed email surfaces an email-shape warning', async ({ page }) => {
  const md = [
    '---',
    'name: Avery Quinn',
    'email: not-an-email',
    '---',
    '',
    '## Summary',
    '',
    'Body text so the preview renders.',
    '',
  ].join('\n');

  await pasteMarkdown(page, md);

  const warnings = page.locator('.preview-warnings');
  await expect(warnings).toBeVisible();
  await expect(warnings).toContainText(/doesn['’]t look like an email address/i);
});

test('terse { GitHub: url } link form does NOT produce a missing-label warning', async ({
  page,
}) => {
  const md = [
    '---',
    'name: Avery Quinn',
    'links:',
    '  - GitHub: https://github.com/example',
    '---',
    '',
    '## Summary',
    '',
    'Body text so the preview renders.',
    '',
  ].join('\n');

  await pasteMarkdown(page, md);

  // Either the warnings block is missing entirely (preferred), or it exists
  // but does not mention a missing label / missing URL — both are valid.
  const warningCount = await page.locator('.preview-warnings').count();
  if (warningCount > 0) {
    const text = (await page.locator('.preview-warnings').textContent()) ?? '';
    expect(text).not.toMatch(/missing a label/i);
    expect(text).not.toMatch(/missing a URL/i);
    expect(text).not.toMatch(/missing both a label and a URL/i);
  }

  // The link should appear in the rendered contact line.
  const article = page.getByRole('article', { name: /rendered resume/i });
  await expect(article.getByRole('link', { name: 'GitHub' })).toBeVisible();
});

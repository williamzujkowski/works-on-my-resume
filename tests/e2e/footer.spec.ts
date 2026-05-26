/**
 * footer.spec.ts — the colophon AppFooter (#172).
 *
 * Locks the bottom-of-page footer's basic contract:
 *   - The element renders on the landing page.
 *   - It carries the GitHub link to the canonical repo.
 *   - It restates the privacy posture in plain language.
 *   - It exposes the shipped version + build month sourced from package.json.
 *   - It is `display: none` under @media print (the print.css contract).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { clearAppStorage, isDisplayNone } from './helpers';

/**
 * Read the shipped version straight from package.json at test-collection
 * time. A plain `readFileSync` keeps the spec independent of TypeScript
 * JSON-import settings (`resolveJsonModule`, import assertions), which
 * are otherwise inconsistent across the test runner and `astro check`
 * passes that include this file.
 */
const pkgUrl = new URL('../../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(fileURLToPath(pkgUrl), 'utf8')) as { version: string };

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
});

test('the footer renders with a GitHub link, privacy reassurance, and version', async ({
  page,
}) => {
  const footer = page.locator('footer.app-footer');
  await expect(footer).toBeVisible();

  // contentinfo landmark — assistive tech treats the footer as such.
  await expect(footer).toHaveAttribute('role', 'contentinfo');

  // The GitHub link must point at the canonical repo URL and announce
  // "GitHub" in its accessible name.
  const link = footer.getByRole('link', { name: /github/i });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute(
    'href',
    'https://github.com/williamzujkowski/works-on-my-resume',
  );
  // External links carry rel=noopener noreferrer for safety.
  await expect(link).toHaveAttribute('rel', /noopener/);
  await expect(link).toHaveAttribute('rel', /noreferrer/);

  // The privacy phrasing is in plain language, not the dev-y CSP framing.
  await expect(footer).toContainText(/no data leaves your browser/i);

  // The shipped version is read from package.json at build time so this
  // assertion can never drift from the actual release.
  await expect(footer).toContainText(`v${pkg.version}`);
});

test('the footer is hidden under @media print', async ({ page }) => {
  const footer = page.locator('footer.app-footer');
  await expect(footer).toBeVisible();

  await page.emulateMedia({ media: 'print' });

  // print.css names `.app-footer` directly AND it carries `data-print-hide`
  // — either rule alone would suffice; assert the resulting computed
  // style rather than coupling to which selector wins.
  expect(await isDisplayNone(footer)).toBe(true);

  await page.emulateMedia({ media: null });
});

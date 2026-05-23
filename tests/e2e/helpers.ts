/**
 * Shared helpers for the e2e suite.
 *
 * Keep these to small, well-named primitives that read in calling tests as
 * if they were prose. Anything cleverer belongs in the test itself.
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

/** Ensure all shortcut prefs are reset before a test that depends on them. */
export async function clearAppStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      /* third-party-cookie blocked storage — nothing to clear */
    }
  });
}

/**
 * Click "Load sample" and wait until the sample resume has been fetched,
 * parsed, and rendered. The parser is debounced by 200 ms — we wait on the
 * canonical Avery Quinn contact-name paragraph in the preview article
 * (scoped to the article since the same string also appears in the editor
 * textarea).
 */
export async function loadSampleResume(page: Page): Promise<void> {
  await page.getByRole('button', { name: /load sample/i }).click();
  const article = page.getByRole('article', { name: /rendered resume/i });
  await expect(article.getByText('Avery Quinn')).toBeVisible({ timeout: 10_000 });
}

/** Convenience locator for the resume preview article. */
export function previewArticle(page: Page): Locator {
  return page.getByRole('article', { name: /rendered resume/i });
}

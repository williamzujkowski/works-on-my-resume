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

/**
 * Open the theme picker and wait for the lazy-loaded ~545-theme dataset
 * (#78) to be in place before returning. Tests that count or filter the
 * option list MUST call this rather than clicking the trigger directly,
 * otherwise they race the dynamic import and may run against just the
 * boot-fallback theme.
 *
 * The "Loading 545 themes…" indicator inside the popover disappears once
 * `loadAllThemesAsync()` resolves; we wait for that signal AND for the
 * option list to actually carry more than one option (the boot state has
 * exactly one). This gives the chunk a deterministic ready-point even on
 * cold-cache CI runs.
 */
export async function openThemePickerReady(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^theme /i }).click();
  const dialog = page.getByRole('dialog', { name: /choose a theme/i });
  await expect(dialog).toBeVisible();
  // The loading status line is only mounted while themesLoading is true.
  // Wait for it to disappear before counting options — its absence is the
  // signal that the full dataset has been normalized into the cache.
  await expect(dialog.getByText(/loading 545 themes/i)).toHaveCount(0, { timeout: 10_000 });
  // Defense-in-depth: only proceed once the list actually carries more than
  // the boot-fallback option, so an unusually fast loading-flash doesn't
  // sneak the test past the gate.
  await expect
    .poll(
      async () =>
        dialog
          .getByRole('listbox', { name: /themes/i })
          .getByRole('option')
          .count(),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(1);
}

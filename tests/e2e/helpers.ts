/**
 * Shared helpers for the e2e suite.
 *
 * Keep these to small, well-named primitives that read in calling tests as
 * if they were prose. Anything cleverer belongs in the test itself.
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Force the document into a specific print mode and switch the viewport to
 * print-media emulation. Mirrors what the app does in production: ResumeStudio
 * writes `printMode` onto `body[data-print-mode]`, and print.css keys off
 * that attribute. Tests that drive the print path through the in-app Export
 * panel are valuable, but slow and chrome-couples — for the CSS-rule lock-in
 * matrix it is simpler and more deterministic to set the attribute directly
 * and assert the resulting computed style.
 */
export async function setPrintMode(
  page: Page,
  mode: 'conservative' | 'theme' | null,
): Promise<void> {
  await page.evaluate((m) => {
    if (m === null) {
      delete document.body.dataset.printMode;
    } else {
      document.body.dataset.printMode = m;
    }
  }, mode);
  await page.emulateMedia({ media: 'print' });
}

/** Reset print-media emulation between tests. */
export async function resetPrintMode(page: Page): Promise<void> {
  await page.emulateMedia({ media: null });
}

/**
 * True iff the element is rendered as `display: none` (the contract that
 * print.css uses for every chrome-hide rule). `toBeHidden()` waffles on
 * `visibility: hidden` vs. detached cases — for the lock-in matrix we want
 * the precise rule that print.css writes.
 */
export async function isDisplayNone(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => getComputedStyle(el).display === 'none');
}

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

/**
 * Wait until the lazy-loaded ~545-theme dataset (#78, #80) is in place.
 *
 * After #80 the dataset is no longer eagerly imported on ResumeStudio mount —
 * it loads on `requestIdleCallback` (or when the picker first opens). Any
 * test that asserts on a theme NAME, on a theme-derived CSS variable, or on a
 * `?theme=<slug>` round-trip must wait for this signal first; otherwise the
 * `--resume-bg` snapshot it captures may still be the boot fallback and swap
 * underneath the test as the idle callback fires.
 *
 * The signal is `<html data-themes-ready="true">`, set in ResumeStudio's
 * post-load handler. The 10 s timeout absorbs cold-cache CI runs.
 */
export async function waitForThemesReady(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.themesReady === 'true', {
    timeout: 10_000,
  });
}

/** Convenience locator for the resume preview article. */
export function previewArticle(page: Page): Locator {
  return page.getByRole('article', { name: /rendered resume/i });
}

/**
 * Expand the mobile editor accordion (#100) when running on the
 * `mobile-iphone-13` Playwright project, no-op otherwise.
 *
 * Background: below 640px the editor pane collapses to a <details>
 * accordion as soon as a resume is loaded, so the preview is the first
 * thing the user sees. Any mobile test that interacts with the editor
 * (textarea, insert-section menu, draft-toggle, the snapshots gate)
 * must first expand the accordion. The summary tap is the natural,
 * accessible way to do that. Idempotent: if the accordion is already
 * open the call is a no-op.
 */
export async function expandMobileEditor(page: Page): Promise<void> {
  const details = page.locator('details.studio__pane--editor');
  // The element always exists in Phase 2 — but guard for the rare cases
  // where a test asserts the empty-state pane.
  if ((await details.count()) === 0) return;
  const isOpen = await details.evaluate((el) => (el as HTMLDetailsElement).open);
  if (!isOpen) {
    await details.locator('summary').click();
  }
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

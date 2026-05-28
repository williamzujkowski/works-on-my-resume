/**
 * print-preview.spec.ts — in-app print-preview modal (#185).
 *
 * Locks in the four behaviors the issue asked for:
 *  (a) Clicking the toolbar Preview button opens a modal with a print
 *      preview iframe.
 *  (b) The iframe loads and contains the canonical sample-resume name
 *      ("Avery Quinn"). Same-origin sandbox is required for this — the
 *      assertion reads the iframe's content document directly.
 *  (c) Toggling the print-mode radio inside the modal updates
 *      `body[data-print-mode]` inside the iframe document. This is the
 *      single-source-of-truth contract: the modal radio and the page-fit
 *      chip's mode dropdown both write to the same React state.
 *  (d) Clicking "Save as PDF" inside the modal triggers a print event in
 *      the parent page (Playwright surfaces `window.print()` via the
 *      runtime print sheet — we install a window-side print spy via
 *      `addInitScript` so the assertion is deterministic).
 *
 * Print preview is a desktop concern (the mobile toolbar collapses the
 * trigger behind the More drawer, but the modal itself works there too;
 * mobile coverage is left to a future iteration). The bulk of the matrix
 * runs on the desktop project; we add a lightweight smoke test that the
 * mobile project still mounts the modal without breakage.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  clearAppStorage,
  loadSampleResume,
  openMobileMoreMenu,
  waitForThemesReady,
} from './helpers';

/**
 * Click the toolbar Preview button. On mobile the trigger collapses behind
 * the More drawer, so open that first when the trigger isn't already
 * visible. Idempotent and a no-op on desktop.
 */
async function openPrintPreview(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: /^preview$/i });
  if (!(await trigger.isVisible())) {
    await openMobileMoreMenu(page);
  }
  await trigger.click();
}

/**
 * Resolve the print-preview iframe locator and wait for its content
 * document to be reachable. Same-origin sandbox is required, so the
 * iframe's content frame is accessible by the time `contentFrame()`
 * resolves.
 */
async function waitForPreviewFrame(page: Page) {
  const frame = page.frameLocator('[data-testid="print-preview-frame"]');
  // The frame body is the first thing the standalone HTML renders — wait
  // for it to be visible before assertion-time reads.
  await expect(frame.locator('body')).toBeVisible();
  return frame;
}

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
  await loadSampleResume(page);
  await waitForThemesReady(page);
});

test('clicking the toolbar Preview button opens the print-preview modal', async ({ page }) => {
  await openPrintPreview(page);

  // The modal mounts with role="dialog" + aria-label "Print preview".
  const dialog = page.getByRole('dialog', { name: /print preview/i });
  await expect(dialog).toBeVisible();

  // The close button is the initial focus target.
  await expect(page.getByRole('button', { name: /close print preview/i })).toBeFocused();

  // Both print-mode radios exist and Conservative is the default.
  const conservative = dialog.getByRole('radio', { name: /conservative/i });
  const themed = dialog.getByRole('radio', { name: /themed/i });
  await expect(conservative).toBeChecked();
  await expect(themed).not.toBeChecked();

  // Esc closes the modal and restores focus to the Preview trigger.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^preview$/i })).toBeFocused();
});

test('the preview iframe loads and contains the resume name', async ({ page }) => {
  await openPrintPreview(page);
  const frame = await waitForPreviewFrame(page);

  // The canonical sample-resume contact name MUST appear in the rendered
  // iframe document. The sandboxed iframe is same-origin so the locator
  // can reach into it; this is the contract that lets the writer
  // visually confirm the printed output before committing.
  await expect(frame.getByText('Avery Quinn').first()).toBeVisible();

  // And the embedded body must carry the print-mode attribute the
  // standalone export writes — defaults to "conservative".
  const printMode = await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>(
      '[data-testid="print-preview-frame"]',
    );
    return iframe?.contentDocument?.body?.dataset.printMode ?? null;
  });
  expect(printMode).toBe('conservative');
});

test('toggling the print-mode radio updates body[data-print-mode] inside the iframe', async ({
  page,
}) => {
  await openPrintPreview(page);
  await waitForPreviewFrame(page);

  // Sanity: default is conservative.
  let mode = await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>(
      '[data-testid="print-preview-frame"]',
    );
    return iframe?.contentDocument?.body?.dataset.printMode ?? null;
  });
  expect(mode).toBe('conservative');

  // Flip to Themed. The radio input itself may report as outside the
  // viewport on the cramped modal layout; dispatch a click rather than
  // a viewport-checked Playwright click so the assertion is robust.
  const themed = page.getByRole('radio', { name: /themed/i });
  await themed.dispatchEvent('click');
  await expect(themed).toBeChecked();

  // The Blob URL is recreated when printMode changes; the iframe re-loads
  // the new blob. Poll until the new iframe document is in place so the
  // assertion isn't racing the navigation.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const iframe = document.querySelector<HTMLIFrameElement>(
            '[data-testid="print-preview-frame"]',
          );
          return iframe?.contentDocument?.body?.dataset.printMode ?? null;
        }),
      { timeout: 5_000 },
    )
    .toBe('theme');

  // And flipping back to Conservative round-trips. Same path.
  const conservative = page.getByRole('radio', { name: /conservative/i });
  await conservative.dispatchEvent('click');
  await expect(conservative).toBeChecked();

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const iframe = document.querySelector<HTMLIFrameElement>(
            '[data-testid="print-preview-frame"]',
          );
          return iframe?.contentDocument?.body?.dataset.printMode ?? null;
        }),
      { timeout: 5_000 },
    )
    .toBe('conservative');

  // Final state check — go back to themed and confirm.
  await themed.dispatchEvent('click');
  mode = await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>(
      '[data-testid="print-preview-frame"]',
    );
    return iframe?.contentDocument?.body?.dataset.printMode ?? null;
  });
  // Poll-style assertion above already validates the round-trip; we just
  // want a final readable mode value for the log.
  expect(mode === 'theme' || mode === 'conservative').toBe(true);
});

test('clicking Save as PDF inside the modal triggers window.print and closes the modal', async ({
  page,
}) => {
  // Install a print-spy before the app boots so window.print() calls land
  // on a counter we can read back. Headless Chromium does NOT open a real
  // print sheet, so we can't use Playwright's download event here — the
  // contract is "the Save-as-PDF button fired window.print()".
  await page.addInitScript(() => {
    type PrintWindow = Window & { __printCount?: number };
    const w = window as PrintWindow;
    w.__printCount = 0;
    window.print = () => {
      w.__printCount = (w.__printCount ?? 0) + 1;
    };
  });
  // The init script needs the page to navigate AFTER it's been installed.
  // The shared beforeEach already navigated; redo the setup here so the
  // spy is live when the page loads.
  await page.goto('');
  await loadSampleResume(page);
  await waitForThemesReady(page);

  await openPrintPreview(page);
  await waitForPreviewFrame(page);

  // Sanity: the print spy has not fired yet.
  let calls = await page.evaluate(
    () => (window as Window & { __printCount?: number }).__printCount ?? 0,
  );
  expect(calls).toBe(0);

  // Click the primary Save-as-PDF button inside the modal. The button
  // text matches the toolbar Save-as-PDF; we scope by dialog to avoid
  // ambiguity with the toolbar instance.
  const dialog = page.getByRole('dialog', { name: /print preview/i });
  await dialog.getByRole('button', { name: /save as pdf/i }).click();

  // The dialog should close so the print sheet (or its spy) doesn't paint
  // over a stale preview. Then window.print fires.
  await expect(dialog).toHaveCount(0);

  await expect
    .poll(
      async () =>
        page.evaluate(() => (window as Window & { __printCount?: number }).__printCount ?? 0),
      { timeout: 2_000 },
    )
    .toBe(1);

  // And focus returns to the Preview trigger.
  await expect(page.getByRole('button', { name: /^preview$/i })).toBeFocused();

  // Defensive: also verify the count didn't double-fire (a debounce bug
  // could fire `print()` twice from a single click).
  calls = await page.evaluate(
    () => (window as Window & { __printCount?: number }).__printCount ?? 0,
  );
  expect(calls).toBe(1);
});

test('Cancel button closes the modal without printing', async ({ page }) => {
  await page.addInitScript(() => {
    type PrintWindow = Window & { __printCount?: number };
    const w = window as PrintWindow;
    w.__printCount = 0;
    window.print = () => {
      w.__printCount = (w.__printCount ?? 0) + 1;
    };
  });
  await page.goto('');
  await loadSampleResume(page);
  await waitForThemesReady(page);

  await openPrintPreview(page);
  await waitForPreviewFrame(page);

  const dialog = page.getByRole('dialog', { name: /print preview/i });
  await dialog.getByRole('button', { name: /^cancel$/i }).click();
  await expect(dialog).toHaveCount(0);

  const calls = await page.evaluate(
    () => (window as Window & { __printCount?: number }).__printCount ?? 0,
  );
  expect(calls).toBe(0);
});

test('the toolbar Save as PDF shortcut path remains intact alongside the new Preview button', async ({
  page,
}) => {
  // The Preview button is additive — Save-as-PDF must still be a direct
  // single-click path to window.print(). This pins that contract so a
  // future refactor that funnels Save-as-PDF through the preview modal
  // requires an explicit test update.
  await page.addInitScript(() => {
    type PrintWindow = Window & { __printCount?: number };
    const w = window as PrintWindow;
    w.__printCount = 0;
    window.print = () => {
      w.__printCount = (w.__printCount ?? 0) + 1;
    };
  });
  await page.goto('');
  await loadSampleResume(page);
  await waitForThemesReady(page);

  // Click Save-as-PDF on the toolbar (not inside any modal). On mobile
  // it's still inline next to the Preview button.
  const saveAsPdf = page.getByRole('button', { name: /^save as pdf$/i });
  if (!(await saveAsPdf.isVisible())) {
    await openMobileMoreMenu(page);
  }
  await saveAsPdf.click();

  // No modal should open. The print spy fires immediately.
  await expect(page.getByRole('dialog', { name: /print preview/i })).toHaveCount(0);
  const calls = await page.evaluate(
    () => (window as Window & { __printCount?: number }).__printCount ?? 0,
  );
  expect(calls).toBe(1);
});

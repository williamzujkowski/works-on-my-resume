/**
 * theming.spec.ts — the theme-picker popover and theme application.
 *
 * Covers:
 *  - Opening the picker via the trigger.
 *  - The search field filters the option list.
 *  - The "Resume-safe themes only" checkbox filters.
 *  - Selecting a theme writes `?theme=<slug>` and changes the rendered
 *    preview (proven by the committed theme name showing in the trigger).
 *  - Closing the popover without selecting reverts a hover preview.
 */
import { test, expect } from '@playwright/test';
import { clearAppStorage, loadSampleResume, openThemePickerReady } from './helpers';

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
  await loadSampleResume(page);
});

test('opening the picker shows the search input and the option list', async ({ page }) => {
  // The picker is code-split (#78); `openThemePickerReady` waits for the
  // lazy-loaded dataset before returning, so the list is fully populated.
  await openThemePickerReady(page);

  // The popover is `<div role="dialog" aria-label="Choose a theme">`.
  await expect(page.getByRole('dialog', { name: /choose a theme/i })).toBeVisible();
  await expect(page.getByRole('combobox')).toBeFocused();
  await expect(page.getByRole('listbox', { name: /themes/i })).toBeVisible();
});

test('typing in the search input narrows the option list', async ({ page }) => {
  await openThemePickerReady(page);

  const list = page.getByRole('listbox', { name: /themes/i });
  const totalBefore = await list.getByRole('option').count();
  expect(totalBefore).toBeGreaterThan(1);

  /* "dracula" is a stable name across the dataset; one or more themes should
     match it, and the filtered count must be strictly less than the total. */
  await page.getByRole('combobox').fill('dracula');
  const filtered = list.getByRole('option');
  await expect.poll(async () => filtered.count()).toBeGreaterThan(0);
  expect(await filtered.count()).toBeLessThan(totalBefore);
  // Every remaining option's name must contain the needle.
  for (const name of await filtered.allTextContents()) {
    expect(name.toLowerCase()).toContain('dracula');
  }
});

/**
 * Read the picker's TOTAL match count (not just the rendered slice).
 * When the list overflows the 60-option cap the picker shows
 * "Showing 60 of M"; below the cap, the total is the rendered count.
 */
async function readPickerTotal(page: import('@playwright/test').Page): Promise<number> {
  const refine = page.locator('.theme-picker__refine');
  if ((await refine.count()) > 0) {
    const text = (await refine.textContent()) ?? '';
    const match = /of\s+(\d+)/.exec(text);
    if (match) return Number(match[1]);
  }
  return page
    .getByRole('listbox', { name: /themes/i })
    .getByRole('option')
    .count();
}

test('the resume-safe-only toggle removes low-contrast themes from the list', async ({ page }) => {
  await openThemePickerReady(page);

  const list = page.getByRole('listbox', { name: /themes/i });
  /* The picker caps the rendered list at 60 options, so a bare option count
     would miss any filtering past that cap. We compare against the picker's
     OWN reported total instead — see readPickerTotal. */
  const totalBefore = await readPickerTotal(page);
  const unsafeBefore = await list.locator('.badge--unsafe').count();
  expect(totalBefore).toBeGreaterThan(0);

  // Only assert filtering when low-contrast themes actually exist — otherwise
  // the toggle has nothing to remove and the test would be vacuous.
  test.skip(unsafeBefore === 0, 'no low-contrast themes visible to filter out');

  await page.getByRole('checkbox', { name: /resume-safe themes only/i }).check();

  // After filtering, no rendered option carries the unsafe badge, and the
  // picker's reported total has dropped.
  await expect(list.locator('.badge--unsafe')).toHaveCount(0);
  const totalAfter = await readPickerTotal(page);
  expect(totalAfter).toBeLessThan(totalBefore);
});

test('selecting a theme writes ?theme=slug and updates the trigger label', async ({ page }) => {
  await openThemePickerReady(page);

  // Pick the first option that is NOT the currently-committed theme so the
  // selection is guaranteed to move state.
  const options = page.getByRole('listbox', { name: /themes/i }).getByRole('option');
  // Resolve the current theme's name from the trigger so we can skip it.
  const triggerName =
    (await page.locator('.theme-picker__trigger-name').first().textContent()) ?? '';

  let chosenName: string | null = null;
  const optionCount = await options.count();
  for (let i = 0; i < optionCount; i += 1) {
    const name = (await options.nth(i).locator('.theme-picker__option-name').textContent())?.trim();
    if (name && name !== triggerName.trim()) {
      chosenName = name;
      await options.nth(i).click();
      break;
    }
  }
  expect(chosenName, 'a different theme was available to select').not.toBeNull();

  // The popover should close on selection.
  await expect(page.getByRole('dialog', { name: /choose a theme/i })).toHaveCount(0);

  // The trigger now reflects the new theme name.
  await expect(page.locator('.theme-picker__trigger-name').first()).toHaveText(chosenName!);

  // And the URL carries a non-empty `?theme=` value.
  await expect
    .poll(() => {
      const url = new URL(page.url());
      return url.searchParams.get('theme') ?? '';
    })
    .not.toBe('');
});

test('closing the picker without selecting reverts a hover preview', async ({ page }) => {
  // Snapshot the document's CSS variable BEFORE any preview occurs.
  const bgBefore = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--resume-bg').trim(),
  );

  await openThemePickerReady(page);
  const options = page.getByRole('listbox', { name: /themes/i }).getByRole('option');

  // Find an option whose theme differs from the current one so hovering
  // actually changes `--resume-bg`. Walk by keyboard so the picker's
  // hover-preview wiring (which fires on activeIndex change too) is exercised.
  const triggerName =
    (await page.locator('.theme-picker__trigger-name').first().textContent()) ?? '';
  const optionCount = await options.count();
  let previewedDifferent = false;
  for (let i = 0; i < optionCount && !previewedDifferent; i += 1) {
    await page.getByRole('combobox').press('ArrowDown');
    const bgNow = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--resume-bg').trim(),
    );
    if (bgNow !== bgBefore) {
      previewedDifferent = true;
    }
    if (i > 20) break; // safety bound — the dataset is large
  }
  expect(previewedDifferent, 'arrow-key preview should reach a different theme').toBe(true);

  // Close without selecting.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /choose a theme/i })).toHaveCount(0);

  // The committed theme — and thus `--resume-bg` — must have reverted.
  const bgAfter = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--resume-bg').trim(),
  );
  expect(bgAfter).toBe(bgBefore);

  // The trigger name should also be unchanged.
  await expect(page.locator('.theme-picker__trigger-name').first()).toHaveText(triggerName);
});

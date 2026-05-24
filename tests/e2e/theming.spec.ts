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
import {
  clearAppStorage,
  loadSampleResume,
  openThemePickerReady,
  waitForThemesReady,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
  await loadSampleResume(page);
  // After #80 the dataset loads lazily on idle. Settle the committed theme
  // BEFORE the test body runs so any `--resume-bg` snapshot taken before
  // opening the picker is not invalidated by a mid-test re-resolution.
  await waitForThemesReady(page);
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
 * Read the picker's match count. The picker no longer caps the rendered list
 * (an earlier MAX_RENDERED hid most of the dataset behind a "refine your
 * search" hint and read to users as "the list stops at B" — see the picker
 * file-header comment). The total is now just the rendered option count.
 */
async function readPickerTotal(page: import('@playwright/test').Page): Promise<number> {
  return page
    .getByRole('listbox', { name: /themes/i })
    .getByRole('option')
    .count();
}

test('the resume-safe-only toggle removes low-contrast themes from the list', async ({ page }) => {
  await openThemePickerReady(page);

  const list = page.getByRole('listbox', { name: /themes/i });
  /* The picker now renders every match (no cap). readPickerTotal stays as a
     stable seam in case we re-introduce some aggregation footer later. */
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

test('a tag chip narrows the list and the live count', async ({ page }) => {
  // The chip filter is composable with the search query and the resume-safe
  // toggle (#87). This case checks the simplest path: pressing `light` should
  // both shrink the visible list and update the live "X of Y themes" readout.
  await openThemePickerReady(page);

  const dialog = page.getByRole('dialog', { name: /choose a theme/i });
  const list = dialog.getByRole('listbox', { name: /themes/i });
  const countLine = dialog.locator('.theme-picker__count');

  // Capture the unfiltered baseline. The denominator in the readout is the
  // full dataset; the numerator equals the rendered option count.
  await expect(countLine).toContainText(/themes$/);
  const baselineMatch = (await countLine.textContent())?.match(/(\d+)\s+of\s+(\d+)/);
  expect(baselineMatch, 'count line should match "X of Y themes"').not.toBeNull();
  const baselineX = Number(baselineMatch![1]);
  const baselineY = Number(baselineMatch![2]);
  expect(baselineX).toBe(await list.getByRole('option').count());
  // With no filters, the rendered list is the full set.
  expect(baselineX).toBe(baselineY);

  // Activate the `light` chip — every remaining option must be a light theme,
  // so none should carry the dark badge.
  await dialog.locator('.theme-picker__tag[data-tag="light"]').click();

  // Live count drops AND the readout still references the same total.
  await expect
    .poll(async () => {
      const txt = (await countLine.textContent()) ?? '';
      const m = txt.match(/(\d+)\s+of\s+(\d+)/);
      return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: -1, y: -1 };
    })
    .toMatchObject({ y: baselineY });
  const filteredX = Number((await countLine.textContent())!.match(/(\d+)\s+of\s+(\d+)/)![1]);
  expect(filteredX).toBeLessThan(baselineX);
  expect(filteredX).toBe(await list.getByRole('option').count());

  // No visible option should carry the `dark` badge after the `light` filter.
  await expect(list.locator('.badge--dark')).toHaveCount(0);
});

test('multiple chips AND-filter and include a known light high-contrast slug', async ({ page }) => {
  // Composing two chips should narrow the list further than either alone,
  // and the resulting set must contain a slug we know qualifies for both:
  // `github-light-default` (light + ~15.8:1 fgOnBg → high-contrast).
  await openThemePickerReady(page);

  const dialog = page.getByRole('dialog', { name: /choose a theme/i });
  const list = dialog.getByRole('listbox', { name: /themes/i });
  const countLine = dialog.locator('.theme-picker__count');

  await dialog.locator('.theme-picker__tag[data-tag="light"]').click();
  const afterLight = Number((await countLine.textContent())!.match(/(\d+)\s+of\s+(\d+)/)![1]);

  await dialog.locator('.theme-picker__tag[data-tag="high-contrast"]').click();
  // The combined filter must shrink the list strictly (high-contrast is not
  // universal among light themes — `light + low-contrast` exists).
  const afterBoth = Number((await countLine.textContent())!.match(/(\d+)\s+of\s+(\d+)/)![1]);
  expect(afterBoth).toBeLessThan(afterLight);
  expect(afterBoth).toBe(await list.getByRole('option').count());

  // `github-light-default` should be reachable under (light AND high-contrast).
  // We match by visible name rather than slug — the option label IS the name —
  // since the picker exposes slugs only as DOM ids, not text.
  const githubLight = list.getByRole('option').filter({ hasText: /github light default/i });
  await expect(githubLight).toHaveCount(1);
});

test('enabling ATS preview tags the toolbar with the greyed-out modifier class and shows the exit pill (#98)', async ({
  page,
}) => {
  const toolbar = page.locator('.studio__toolbar');
  // Baseline: toolbar is in normal mode — no modifier class, no exit pill.
  await expect(toolbar).not.toHaveClass(/studio__toolbar--ats-active/);
  await expect(page.getByRole('button', { name: /exit ats preview/i })).toHaveCount(0);

  // Flip ATS mode on via the existing toggle.
  await page.getByRole('switch', { name: /ats preview/i }).check();

  // The toolbar now carries the modifier class (the visible grey-out is
  // applied by CSS via this class), and the persistent exit pill is shown.
  await expect(toolbar).toHaveClass(/studio__toolbar--ats-active/);
  const exitPill = page.getByRole('button', { name: /exit ats preview/i });
  await expect(exitPill).toBeVisible();

  // Pressing the exit pill returns the toolbar to normal mode.
  await exitPill.click();
  await expect(toolbar).not.toHaveClass(/studio__toolbar--ats-active/);
  await expect(page.getByRole('button', { name: /exit ats preview/i })).toHaveCount(0);
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

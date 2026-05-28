/**
 * theming.spec.ts — the theme-picker popover and theme application.
 *
 * Covers:
 *  - Opening the picker via the trigger.
 *  - The search field filters the option list.
 *  - Selecting a theme writes `?theme=<slug>` and changes the rendered
 *    preview (proven by the committed theme name showing in the trigger).
 *  - Closing the popover without selecting reverts a hover preview.
 *
 * Note: the "Resume-safe themes only" toggle spec went away in #153 — every
 * theme in the dataset clears the resume-safe 7:1 threshold by construction
 * now, so the toggle and its UI plumbing were removed.
 */
import { test, expect } from '@playwright/test';
import {
  clearAppStorage,
  loadSampleResume,
  openSettingsDrawer,
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
  // After #139 the page-fit chip also exposes a `<select>` (implicit role
  // combobox); scope the focus assertion to the picker's own search box.
  await expect(page.getByRole('combobox', { name: /search themes/i })).toBeFocused();
  await expect(page.getByRole('listbox', { name: /themes/i })).toBeVisible();
});

test('typing in the search input narrows the option list', async ({ page }) => {
  await openThemePickerReady(page);

  const list = page.getByRole('listbox', { name: /themes/i });
  const totalBefore = await list.getByRole('option').count();
  expect(totalBefore).toBeGreaterThan(1);

  /* "dracula" is a stable name across the dataset; one or more themes should
     match it, and the filtered count must be strictly less than the total.
     After #139 the page-fit chip also exposes a `<select>`; scope the
     combobox lookup so the search input is unambiguous. */
  await page.getByRole('combobox', { name: /search themes/i }).fill('dracula');
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

// The "resume-safe-only toggle removes low-contrast themes" spec was
// deleted in #153. The dataset was filtered down to the 465 themes that
// clear the 7:1 body-text threshold, the picker's toggle was removed, and
// `.badge--unsafe` no longer renders — so the assertion had no remaining
// surface to test.

test('every rendered option is resume-safe — no low-contrast badge survives (#153)', async ({
  page,
}) => {
  // The negative invariant the dropped toggle test used to enforce IS still
  // worth pinning down: after #153 no option row should carry the unsafe
  // badge, because every theme in the shipped dataset clears the 7:1
  // resume-safe body-text threshold. If this regresses (e.g. someone
  // re-adds an unsafe theme to the dataset), the badge would appear and
  // this would catch it.
  await openThemePickerReady(page);
  const list = page.getByRole('listbox', { name: /themes/i });
  // The list should be populated (defense in depth on top of openThemePickerReady).
  expect(await readPickerTotal(page)).toBeGreaterThan(1);
  await expect(list.locator('.badge--unsafe')).toHaveCount(0);
  // And the toggle itself must be gone — no checkbox with that label
  // should remain in the popover.
  await expect(page.getByRole('checkbox', { name: /resume-safe themes only/i })).toHaveCount(0);
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
  // The chip filter is composable with the search query (#87). This case
  // checks the simplest path: pressing `light` should both shrink the
  // visible list and update the live "X of Y themes" readout.
  await openThemePickerReady(page);

  const dialog = page.getByRole('dialog', { name: /choose a theme/i });
  const list = dialog.getByRole('listbox', { name: /themes/i });
  const countLine = dialog.locator('.theme-picker__count');

  // #183: the count line is HIDDEN in the unfiltered baseline — the curated
  // "Starting points" row takes over the "what am I looking at" role there.
  // The baseline denominator is therefore measured directly from the
  // listbox rather than parsed from a non-rendered count string.
  await expect(countLine).toHaveCount(0);
  const baselineY = await list.getByRole('option').count();
  expect(baselineY).toBeGreaterThan(1);

  // Activate the `light` chip — every remaining option must be a light theme,
  // so none should carry the dark badge. The chip flips the picker into
  // filtered mode, which is where the count line re-mounts.
  await dialog.locator('.theme-picker__tag[data-tag="light"]').click();
  await expect(countLine).toBeVisible();

  // Live count drops AND the readout still references the same total.
  await expect
    .poll(async () => {
      const txt = (await countLine.textContent()) ?? '';
      const m = txt.match(/(\d+)\s+of\s+(\d+)/);
      return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: -1, y: -1 };
    })
    .toMatchObject({ y: baselineY });
  const filteredX = Number((await countLine.textContent())!.match(/(\d+)\s+of\s+(\d+)/)![1]);
  expect(filteredX).toBeLessThan(baselineY);
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

  // #128: the ATS toggle moved into the Settings drawer. Open the drawer
  // and flip the switch. The exit-pill that appears in the toolbar is the
  // primary "you're in ATS mode" affordance for sighted users.
  await openSettingsDrawer(page);
  await page.getByRole('switch', { name: /ats preview/i }).check();
  // Close the drawer so the toolbar grey-out and exit pill are unobstructed.
  await page.keyboard.press('Escape');

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

// The "curated theme presets" spec for #95 was deleted in #132 — the Presets
// row was redundant with the Layout selector (same "Modern" word, two
// different meanings; preset active-state went stale whenever its bundled
// theme or layout changed). Theme picker + Layout selector are now the two
// canonical independent axes.

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
    // After #139 the page-fit chip also exposes a `<select>` (implicit
    // role combobox); scope to the picker's own search input.
    await page.getByRole('combobox', { name: /search themes/i }).press('ArrowDown');
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

test('curated "Starting points" row renders eight entries above the search input (#183)', async ({
  page,
}) => {
  // The curated row is the picker's "land in one click" surface: eight
  // hand-picked tiles that sit above the search input. The dataset is
  // lazy-loaded (#78), so we go through the same ready-helper every other
  // picker test uses — otherwise the row would briefly be empty while
  // CURATED_STARTING_POINTS slugs hydrate against the boot fallback.
  await openThemePickerReady(page);

  const dialog = page.getByRole('dialog', { name: /choose a theme/i });
  const curated = dialog.locator('.theme-picker__curated');
  await expect(curated).toBeVisible();

  // Exactly eight tiles, matching CURATED_STARTING_POINTS — if any slug were
  // typoed or removed from `src/data/themes.json` the row would silently
  // shrink, so this is also the typo-detector for the curated list.
  const tiles = curated.locator('.theme-picker__curated-item');
  await expect(tiles).toHaveCount(8);

  // First tile is the new default: flexoki-light. Verifying by `data-slug`
  // is more stable than matching the display name (which is sourced from
  // the upstream theme JSON).
  await expect(tiles.first()).toHaveAttribute('data-slug', 'flexoki-light');
});

test('clicking the first curated tile commits flexoki-light (#183)', async ({ page }) => {
  await openThemePickerReady(page);

  const dialog = page.getByRole('dialog', { name: /choose a theme/i });
  const tiles = dialog.locator('.theme-picker__curated .theme-picker__curated-item');

  // Resolve the display name from the tile BEFORE click — the trigger label
  // is the theme's display name, not the slug, so we cross-check both signals
  // (URL gets the slug; trigger gets the name).
  const firstName =
    (await tiles.first().locator('.theme-picker__curated-name').textContent())?.trim() ?? '';
  expect(firstName.length).toBeGreaterThan(0);

  await tiles.first().click();

  // The popover closes on selection — same handler as the listbox rows.
  await expect(dialog).toHaveCount(0);

  // URL gains `?theme=flexoki-light` (the trigger-label cross-check below
  // is the redundant assertion the spec calls for).
  await expect
    .poll(() => new URL(page.url()).searchParams.get('theme') ?? '')
    .toBe('flexoki-light');

  // Trigger label updates to the chosen theme's name.
  await expect(page.locator('.theme-picker__trigger-name').first()).toHaveText(firstName);
});

test('typing in search hides the curated row and reveals the count line (#183)', async ({
  page,
}) => {
  await openThemePickerReady(page);

  const dialog = page.getByRole('dialog', { name: /choose a theme/i });
  const curated = dialog.locator('.theme-picker__curated');
  const countLine = dialog.locator('.theme-picker__count');

  // Baseline (unfiltered): curated visible, count line hidden — the curated
  // row TAKES OVER the "what am I looking at" role in the unfiltered state.
  await expect(curated).toBeVisible();
  await expect(countLine).toHaveCount(0);

  // Typing a query flips the mode: curated disappears, count line returns.
  await page.getByRole('combobox', { name: /search themes/i }).fill('dracula');
  await expect(curated).toHaveCount(0);
  await expect(countLine).toBeVisible();
  await expect(countLine).toContainText(/themes$/);

  // Clearing the query restores the unfiltered baseline.
  await page.getByRole('combobox', { name: /search themes/i }).fill('');
  await expect(curated).toBeVisible();
  await expect(countLine).toHaveCount(0);
});

test('activating a tag chip hides the curated row (#183)', async ({ page }) => {
  // Tag chips are the other half of "filtered mode" — they should hide the
  // curated row the same way a search query does. The `light` chip is a
  // safe one to press: it does not narrow the list to nothing.
  await openThemePickerReady(page);

  const dialog = page.getByRole('dialog', { name: /choose a theme/i });
  const curated = dialog.locator('.theme-picker__curated');
  await expect(curated).toBeVisible();

  await dialog.locator('.theme-picker__tag[data-tag="light"]').click();
  await expect(curated).toHaveCount(0);
});

test('the preview header shows exactly ONE WCAG pill — collapsed worst-case (#130)', async ({
  page,
}) => {
  // The badge has the .studio__pane-wcag class regardless of level. After
  // #130 the preview header carries a SINGLE pill — the worst of the two
  // pairs (body text and accent) — not the legacy two-chip layout.
  const badges = page.locator('.studio__pane-header .studio__pane-wcag');
  await expect(badges).toHaveCount(1);

  // The pill's accessible label spells out BOTH ratios so screen-reader
  // users still get the per-pair breakdown that the visual single-pill
  // collapses.
  const single = badges.first();
  await expect(single).toHaveAttribute('aria-label', /Body text:.*Accent:/i);

  // And the visible text is the single `<glyph> LEVEL · ratio:1` format,
  // not a pair joined by a separator. The leading glyph (✓ / AA / ⚠) is
  // followed by the level + ratio. Normalize whitespace first so a
  // newline between glyph and text doesn't trip the match.
  const text = (await single.innerText()).replace(/\s+/g, ' ').trim();
  expect(text).toMatch(/^(✓|AA|⚠)\s+(AAA|AA|fails)\s+·\s+\d+(\.\d+)?:1$/);
});

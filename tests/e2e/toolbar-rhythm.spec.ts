/**
 * toolbar-rhythm.spec.ts — locks in the #135 visual contract.
 *
 * The toolbar dropped its pill outlines and adopted a kicker + value
 * rhythm with hairline separators:
 *
 *   THEME  <name> ▾  │  LAYOUT  Classic Modern Compact  │  FIT  1.4p  │
 *     [Save as PDF]  │  Export ▾  │  ⚙
 *
 * Acceptance:
 *   1. At 1280×800, at least three visible kicker labels (THEME, LAYOUT,
 *      FIT) read in the toolbar.
 *   2. Save-as-PDF is the ONLY `.btn--primary` in the toolbar — every
 *      other control reads as text-with-affordance.
 *   3. The hairline separators (`.studio__toolbar-sep`) are present —
 *      at least one is in the DOM — so the grouping is conveyed
 *      visually. Visibility is asserted via `offsetParent !== null`
 *      so a 1-px wide element is still counted (offsetWidth on a
 *      single-px element is reported as 1, but the layout-shrink
 *      case where width truncates to 0 is rare and we'd rather not
 *      depend on offsetWidth-floor heuristics).
 *
 * Mobile is out of scope: the More menu (#131) reshapes the toolbar
 * into a column drawer, so the hairlines collapse with the rest of the
 * collapsible controls. The desktop project carries the rhythm.
 */
import { test, expect } from '@playwright/test';
import { clearAppStorage, loadSampleResume, waitForThemesReady } from './helpers';

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
});

test('at 1280×800 the toolbar shows THEME, LAYOUT, FIT kicker labels', async ({
  page,
  isMobile,
}) => {
  test.skip(
    isMobile === true,
    'kicker rhythm is the desktop layout (mobile collapses behind More)',
  );

  await loadSampleResume(page);
  await waitForThemesReady(page);

  const toolbar = page.locator('.studio__toolbar');
  await expect(toolbar).toBeVisible();

  /* Collect the visible-text content of every `.section-kicker` inside
     the toolbar root. Lowercase + trim so the assertion is robust to a
     CSS uppercase transform vs. JSX literal-case drift; the rule is
     "the label is THERE", not "the label is upper-cased at the source". */
  const kickerTexts = await toolbar
    .locator('.section-kicker')
    .evaluateAll((nodes) =>
      nodes
        .map((n) => (n.textContent || '').trim().toLowerCase())
        .filter((t) => t.length > 0),
    );

  expect(kickerTexts).toEqual(expect.arrayContaining(['theme', 'layout']));

  /* The page-fit pill carries its own "Fit:" / "Fits" kicker INSIDE the
     label text (an explicit `.section-kicker` span would have duplicated
     the word — the label already starts with "Fit"). Assert the pill is
     visible and its text leads with the kicker word so the FIT rhythm is
     present alongside THEME and LAYOUT. */
  const pageFitPill = toolbar.locator('.page-fit__pill');
  await expect(pageFitPill).toBeVisible();
  await expect(pageFitPill).toHaveText(/Fits 1 page|Fit: \d\.\d pages/);
});

test('Save as PDF is the only .btn--primary in the toolbar', async ({ page }) => {
  await loadSampleResume(page);
  await waitForThemesReady(page);

  /* Every `.btn--primary` inside the toolbar — accessible name must read
     as Save as PDF. Any extra primary fill is a violation of the rhythm
     since the rest of the cluster should read as text-with-affordance. */
  const primaries = page.locator('.studio__toolbar .btn--primary');
  await expect(primaries).toHaveCount(1);
  await expect(primaries.first()).toHaveText(/save as pdf/i);
});

test('hairline separators are present between toolbar groups', async ({ page, isMobile }) => {
  test.skip(isMobile === true, 'separators collapse on mobile with the More-menu reshape');

  await loadSampleResume(page);
  await waitForThemesReady(page);

  /* The separators are real DOM elements (`<span class="studio__toolbar-sep" />`)
     wrapped in `studio__toolbar-collapsible` so the mobile drawer can
     omit them. On desktop at 1280×800 we expect at least three present —
     matching the three group boundaries that survive a resume-loaded
     toolbar (THEME│LAYOUT, FIT│Save, Export│Settings). The exact count
     can drift one or two if a future PR rearranges groups, so we assert
     a floor rather than equality. We count nodes whose `offsetParent` is
     non-null — i.e. the element participates in layout — since a 1-px
     hairline reports offsetWidth=1 and offsetHeight≥1 but we want a
     defensive check that doesn't break if a future tweak swaps the
     rendered box size. */
  const presentCount = await page
    .locator('.studio__toolbar .studio__toolbar-sep')
    .evaluateAll(
      (nodes) =>
        nodes.filter((n) => (n as HTMLElement).offsetParent !== null).length,
    );
  expect(presentCount).toBeGreaterThanOrEqual(3);
});

test('Theme picker trigger has no panel outline (drops the pill chrome)', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile === true, 'mobile trigger has its own collapsed shape');

  await loadSampleResume(page);
  await waitForThemesReady(page);

  /* The trigger's resting background should be transparent (no panel
     fill) and its border should not paint a visible 1-px ring — the
     #135 rhythm dropped the pill outline so the trigger reads as
     `THEME [name] ▾` text with affordance.

     We use the CSS-class locator (`.theme-picker__trigger`) rather than
     a role-name search: CI's accessibility tree has multiple buttons
     whose names start with the word "Theme" (the Settings drawer's
     theme-nav row joins the picker in the toolbar's a11y tree). The
     class is the unambiguous selector.

     Move the pointer somewhere innocuous before sampling so we never
     pick up the trigger's :hover wash (which is the intended active
     state, not the resting state). */
  await page.mouse.move(0, 0);
  const trigger = page.locator('.theme-picker__trigger').first();
  await expect(trigger).toBeVisible();
  const style = await trigger.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      background: cs.backgroundColor,
      borderTop: cs.borderTopColor,
    };
  });

  /* rgba(...) with alpha = 0, or the literal "transparent" string — both
     are valid representations of "no paint at rest". */
  expect(style.background.replace(/\s/g, '')).toMatch(/(rgba\([^)]+,0\)|transparent)/);
  expect(style.borderTop.replace(/\s/g, '')).toMatch(/(rgba\([^)]+,0\)|transparent)/);
});

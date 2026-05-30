/**
 * empty-state-hero.spec.ts — the Phase 1 hero block (#127).
 *
 * Phase 1 lands a loud, OKLCH-inspired landing hero above the workbench:
 *   - Title (`Works on My Resume`) at display size.
 *   - Tagline with inline keyboard chips (the discoverable shortcuts).
 *   - Stat counter row — THEMES / LAYOUTS / TEMPLATES / OFFLINE-READY.
 *
 * Once a resume is loaded, the hero collapses to the static AppHeader
 * chrome (no double-render of the brand row). This spec validates that
 * round-trip end-to-end.
 */
import { test, expect } from '@playwright/test';
import { clearAppStorage, loadSampleResume } from './helpers';

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
});

test('the hero is rendered on Phase 1 with title, kbd-chip tagline, and stat counters', async ({
  page,
}) => {
  const hero = page.locator('.app-hero');
  await expect(hero).toBeVisible();

  // The title carries the brand name at display size.
  await expect(hero.getByRole('heading', { name: /works on my resume/i })).toBeVisible();

  // The tagline carries inline <kbd> chips for the headline shortcuts.
  // Match the actual chip elements so a future copy tweak that loses the
  // chips would fail this assertion.
  const heroKbds = hero.locator('kbd');
  // We render four kbd chips: ←, →, /, r.
  await expect(heroKbds).toHaveCount(4);

  // The stat counters: each documented label must be present in the
  // stat-label region. The tagline above also mentions "themes" and
  // "layouts", so scope strictly to the .app-hero__stat-label nodes.
  const statLabels = hero.locator('.app-hero__stat-label');
  await expect(statLabels.filter({ hasText: /^themes$/i })).toBeVisible();
  await expect(statLabels.filter({ hasText: /^layouts$/i })).toBeVisible();
  await expect(statLabels.filter({ hasText: /^templates$/i })).toBeVisible();
  await expect(statLabels.filter({ hasText: /^offline-ready$/i })).toBeVisible();

  // While the hero is up, the static AppHeader chrome is hidden via the
  // body[data-app-phase='hero'] CSS rule.
  await expect(page.locator('.app-header')).toBeHidden();
});

test('#198 the empty-state hero opens the Markdown format reference', async ({ page }) => {
  const hero = page.locator('.app-hero');
  const trigger = hero.getByRole('button', { name: /^markdown format$/i });

  await expect(trigger).toBeVisible();
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: /^markdown format$/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /^frontmatter$/i })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /^sections$/i })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /^llm handoff$/i })).toBeVisible();

  await dialog.getByRole('button', { name: /close/i }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('#173 the hero carries a 3-step "How it works" list with the dynamic theme count', async ({
  page,
}) => {
  const hero = page.locator('.app-hero');
  await expect(hero).toBeVisible();

  // Three numbered steps, each with a "1." / "2." / "3." ochre numeral.
  const steps = hero.locator('.app-hero__step');
  await expect(steps).toHaveCount(3);

  const nums = hero.locator('.app-hero__step-num');
  await expect(nums.nth(0)).toHaveText('1.');
  await expect(nums.nth(1)).toHaveText('2.');
  await expect(nums.nth(2)).toHaveText('3.');

  // Body copy. The middle step embeds the live theme count — read it
  // from the Themes stat counter so the assertion stays in lockstep
  // with whatever THEMES.length resolves to at runtime (post-tick-up,
  // when the lazy dataset has fully landed).
  await expect(steps.nth(0)).toContainText('Write or paste your resume in Markdown.');
  await expect(steps.nth(2)).toContainText('Save as PDF. It never leaves your browser.');

  // The middle step's "N to choose from" must agree with the same
  // `themeCount` prop the Themes stat reads. Both surfaces consume the
  // same source, so once the lazy ~465-theme dataset lands they must
  // converge. Poll the pair until they match — this avoids two
  // independent reads racing against the lazy-load resolve and the
  // mount tick-up animation.
  const themesValue = hero
    .locator('.app-hero__stat')
    .filter({ has: page.locator('.app-hero__stat-label', { hasText: /^themes$/i }) })
    .locator('.app-hero__stat-value');
  await expect.poll(
    async () => {
      const counter = Number((await themesValue.textContent()) ?? '0');
      const stepText = (await steps.nth(1).textContent()) ?? '';
      const match = stepText.match(/Pick a theme — (\d+) to choose from\./);
      const stepCount = match ? Number(match[1]) : NaN;
      return counter > 0 && counter === stepCount;
    },
    {
      timeout: 5000,
      message: 'Themes counter and step copy should converge on the same count',
    },
  ).toBe(true);
});

test('#173 the 3-step list disappears once a resume is loaded', async ({ page }) => {
  // Baseline: the steps are present in the empty state.
  await expect(page.locator('.app-hero__steps')).toHaveCount(1);

  // Load the bundled sample → workbench phase.
  await loadSampleResume(page);

  // Hero (and its steps list) is gone.
  await expect(page.locator('.app-hero__steps')).toHaveCount(0);
});

test('loading a resume collapses the hero — the static AppHeader returns', async ({ page }) => {
  // Baseline: hero present.
  await expect(page.locator('.app-hero')).toHaveCount(1);

  // Load the bundled sample, which transitions to Phase 2.
  await loadSampleResume(page);

  // Hero is gone — no double-render of the brand row.
  await expect(page.locator('.app-hero')).toHaveCount(0);

  // The static AppHeader is now the brand surface again.
  await expect(page.locator('.app-header')).toBeVisible();
});

test('the body-level data-app-phase attribute flips on load + unload', async ({ page }) => {
  // Phase 1 → data-app-phase='hero'.
  await expect(page.locator('body')).toHaveAttribute('data-app-phase', 'hero');

  await loadSampleResume(page);

  // Phase 2 → data-app-phase='workbench'.
  await expect(page.locator('body')).toHaveAttribute('data-app-phase', 'workbench');
});

/**
 * #140 — stat counters tick up on mount with a staggered entrance.
 *
 * The numbers animate from 0 to their final values over ~500 ms via
 * `requestAnimationFrame` writing `textContent`. Themes leads, Layouts
 * staggers +100 ms, Templates +200 ms; the Offline-ready check fades in
 * via a CSS class at +400 ms. Under prefers-reduced-motion: reduce the
 * effect is skipped — the final values are rendered immediately at mount.
 *
 * Both specs use `page.emulateMedia` to pin the reduced-motion preference
 * BEFORE navigation, so AppHero's mount-time `matchMedia` read picks up
 * the requested value. (Setting `reducedMotion` via `test.use` is unreliable
 * when the worker reuses contexts across describe blocks.)
 */
test('#140 stat counters animate on mount and tag the check stat with --check-enter', async ({
  page,
}) => {
  // The top-level beforeEach already navigated; reset media + re-navigate
  // so AppHero's mount-time `matchMedia` read picks up the requested value.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('');

  // Hero is mounted before we assert on its children.
  await expect(page.locator('.app-hero')).toBeVisible();

  // Three numeric stat values (Themes, Layouts, Templates).
  const numericStats = page.locator('.app-hero__stat-value:not(.app-hero__stat-value--icon)');
  await expect(numericStats).toHaveCount(3);

  // After the entrance budget all three numeric stats land on a positive
  // integer. We don't pin the exact themeCount because the hero is
  // rendered while the lazy ~465-theme dataset is still resolving — the
  // boot fallback may be lower. The animation contract is: from 0, to a
  // positive integer, within ~1 s.
  await expect.poll(
    async () => {
      const texts = await numericStats.allTextContents();
      return texts.every((t) => {
        const n = Number(t);
        return Number.isInteger(n) && n > 0;
      });
    },
    {
      timeout: 1500,
      message: 'stat counters should reach their final values within ~1 s',
    },
  ).toBe(true);

  // Sanity-check the icon stat: it carries the `--check-enter` modifier
  // when motion is allowed.
  await expect(page.locator('.app-hero__stat--check')).toHaveClass(/app-hero__stat--check-enter/);
});

test('#140 stat counters skip the entrance under prefers-reduced-motion: reduce', async ({
  page,
}) => {
  // The top-level beforeEach already navigated; set the media query and
  // re-navigate so AppHero's mount-time `matchMedia` read sees `reduce`.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('');

  // The hero is present.
  await expect(page.locator('.app-hero')).toBeVisible();

  // Under reduced-motion the check stat must NOT carry the entrance
  // modifier — AppHero.tsx omits it. (This also means the icon is
  // visible at opacity 1 from frame zero.)
  await expect(page.locator('.app-hero__stat--check')).not.toHaveClass(
    /app-hero__stat--check-enter/,
  );

  // The numeric stat values must already be at their final state — no
  // "0" anywhere among the three numeric counters.
  const numericStats = page.locator('.app-hero__stat-value:not(.app-hero__stat-value--icon)');
  await expect(numericStats).toHaveCount(3);
  for (const text of await numericStats.allTextContents()) {
    const n = Number(text);
    // Final state must be a positive integer — no transient zero.
    expect(Number.isInteger(n) && n > 0).toBe(true);
  }
});

/**
 * #169 — pre-hydration no-flash invariant.
 *
 * The static AppHeader is default-hidden in CSS (`display: none` on
 * `.app-header`) and only revealed when the React island lands and flips
 * `body[data-app-phase='workbench']` (#165). This test locks in that
 * contract by delaying the ResumeStudio bundle briefly: during the
 * pre-hydration window the header MUST NOT flash visible, and the empty
 * landing surface (with the Load-sample CTA) MUST keep it hidden after
 * hydration completes. Only when a resume actually loads does the strip
 * reveal.
 *
 * Route pattern matches the production chunk shape
 * `ResumeStudio.<hash>.js` emitted by Astro's React island build.
 */
test('app-header stays hidden during the hydration window', async ({ page }) => {
  // Block the React JS bundle briefly so we can observe pre-hydration state.
  // The delay only fires once — subsequent requests (HMR, retries) pass
  // straight through, which keeps the spec from sagging on the rest of the
  // run.
  let delayed = false;
  await page.route(/ResumeStudio.*\.js$/, async (route) => {
    if (!delayed) {
      delayed = true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return route.continue();
  });
  await page.goto('');
  // In the pre-hydration window, the app-header should NOT be visible.
  // The static markup ships with `display: none` on `.app-header`; this
  // assertion would fail if anyone ever flipped that default.
  await expect(page.locator('.app-header')).toBeHidden();
  // After hydration completes, on the landing surface, it stays hidden —
  // the Load-sample CTA is the signal that the hero has fully mounted.
  await expect(page.getByRole('button', { name: /load sample/i })).toBeVisible();
  await expect(page.locator('.app-header')).toBeHidden();
  // Once a resume loads, the strip reveals (workbench phase).
  await page.getByRole('button', { name: /load sample/i }).click();
  await expect(page.locator('.app-header')).toBeVisible();
});

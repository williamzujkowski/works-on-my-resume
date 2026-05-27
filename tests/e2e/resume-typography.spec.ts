/**
 * resume-typography.spec.ts (#184) — lock in the small typographic refinements
 * that take the rendered resume closer to a premium printed document.
 *
 * Five proposals from #184 landed as small CSS edits in src/styles/resume.css
 * (+ a print-mode line-height bump in src/styles/print.css). The values are
 * subtle enough that a stray future edit could revert them without anybody
 * noticing in a visual diff — so we lock them in with computed-style asserts
 * against real DOM nodes the sample resume produces.
 *
 * What we assert (and why each value):
 *   1. H2 section rule          → 1px solid, color with alpha ≈ 0.5 (hairline)
 *   2. Body line-height (screen)→ 1.6 (≈ 25.6px @ 16px base)
 *      Body line-height (print) → 1.55 (rule lives in print.css)
 *   3. Bullet <li> bottom gap   → 0.35rem (~5.6px @ 16px base)
 *   4. H2 margin-top            → 2.15rem (~34.4px) — was 1.9rem
 *   5. H1 letter-spacing        → -0.012em (currently rendered as a px value)
 *
 * We deliberately do NOT pin every margin/padding on the document — the
 * visual baseline catches gross regressions. These assertions catch the
 * exact numbers from #184 so a refactor that silently widens or tightens
 * any of them gets flagged at the rule level, not just visually.
 */
import { test, expect } from '@playwright/test';
import {
  clearAppStorage,
  loadSampleResume,
  previewArticle,
  setPrintMode,
  resetPrintMode,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  // Empty string resolves against the Playwright baseURL (which already
  // carries the `/works-on-my-resume/` base path); `'/'` would absolute
  // back to the server root and bypass the base, producing a 404.
  await page.goto('');
  await loadSampleResume(page);
});

test.afterEach(async ({ page }) => {
  await resetPrintMode(page);
});

test('H2 section rule is a hairline (1px + ~0.5 alpha)', async ({ page }) => {
  const h2 = previewArticle(page).locator('h2').first();
  await expect(h2).toBeVisible();

  const { borderBottomStyle, borderBottomWidth, borderBottomColor } = await h2.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      borderBottomStyle: cs.borderBottomStyle,
      borderBottomWidth: cs.borderBottomWidth,
      borderBottomColor: cs.borderBottomColor,
    };
  });

  expect(borderBottomStyle).toBe('solid');
  expect(borderBottomWidth).toBe('1px');

  // The color comes from `color-mix(in srgb, var(--resume-muted) 50%, transparent)`.
  // Chromium 132+ serializes this as `color(srgb r g b / a)` (CSS Color 4
  // function), older engines may emit `rgba(r, g, b, a)` or `rgb(r g b / a)`.
  // We cover all three shapes and only assert the alpha component, since the
  // RGB triple is themed (it shifts with --resume-muted).
  const alphaMatch =
    // color(srgb r g b / a)
    borderBottomColor.match(/color\([^)]*\/\s*([0-9.]+)\s*\)/) ??
    // rgb(r g b / a) — space-separated CSS Color 4 form
    borderBottomColor.match(/rgba?\([^/)]*\/\s*([0-9.]+)\s*\)/) ??
    // rgba(r, g, b, a) — legacy form
    borderBottomColor.match(/rgba\([^)]*,\s*([0-9.]+)\s*\)/);
  expect(alphaMatch, `expected alpha in computed color, got: ${borderBottomColor}`).not.toBeNull();
  const alpha = Number(alphaMatch![1]);
  expect(alpha).toBeGreaterThan(0.4);
  expect(alpha).toBeLessThan(0.6);
});

test('on-screen body line-height is 1.6 (≈ 25.6px @ 16px base)', async ({ page }) => {
  // The article IS the `.resume-preview` node (see ResumePreview.tsx) — the
  // line-height rule lives on that element directly, so we query it.
  const preview = previewArticle(page);
  const lineHeight = await preview.evaluate((el) => getComputedStyle(el).lineHeight);
  // 1.6 × 16 = 25.6 — browsers round to 25.6px or 25.5938... px depending
  // on subpixel handling. Be lenient on the trailing digit.
  const numeric = Number.parseFloat(lineHeight);
  expect(numeric).toBeGreaterThan(25);
  expect(numeric).toBeLessThan(26);
});

test('print body line-height bumps to 1.55 (≈ 17.05px @ 11pt)', async ({ page }) => {
  // Engage print emulation so print.css rules apply.
  await setPrintMode(page, 'conservative');
  const preview = previewArticle(page);

  const { lineHeight, fontSize } = await preview.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { lineHeight: cs.lineHeight, fontSize: cs.fontSize };
  });
  // line-height is unitless 1.55 → resolves to 1.55 × fontSize in px.
  const fontPx = Number.parseFloat(fontSize);
  const lhPx = Number.parseFloat(lineHeight);
  const ratio = lhPx / fontPx;
  expect(ratio).toBeGreaterThan(1.54);
  expect(ratio).toBeLessThan(1.56);
});

test('bullet <li> has ~0.35rem bottom margin (one notch more breathing room)', async ({ page }) => {
  // First bullet from the sample resume's first list.
  const li = previewArticle(page).locator('li').first();
  await expect(li).toBeVisible();
  const marginBottom = await li.evaluate((el) => getComputedStyle(el).marginBottom);
  // 0.35rem × 16px = 5.6px; match within a fractional-pixel tolerance.
  const px = Number.parseFloat(marginBottom);
  expect(px).toBeGreaterThan(5.3);
  expect(px).toBeLessThan(5.9);
});

test('H2 margin-top is 2.15rem (~34.4px) — proposal 4 vertical rhythm', async ({ page }) => {
  // Use h2:not(:first-child) so we measure section-to-section rhythm; the
  // very first h2 may be subject to `:first-child` margin-collapsing rules.
  const h2 = previewArticle(page).locator('h2').nth(1);
  await expect(h2).toBeVisible();
  const marginTop = await h2.evaluate((el) => getComputedStyle(el).marginTop);
  // 2.15rem × 16px = 34.4px. Be lenient on fractional rendering.
  const px = Number.parseFloat(marginTop);
  expect(px).toBeGreaterThan(33.9);
  expect(px).toBeLessThan(34.9);
});

test('H1 (name) letter-spacing tightened to -0.012em', async ({ page }) => {
  // ResumePreview strips a leading body <h1> to avoid duplicating the name
  // (see ResumePreview.tsx). The displayed "H1" of the document is the
  // .resume-preview__contact-name node rendered from frontmatter — that
  // is where proposal 5 of #184 actually lands visually. We assert on
  // both that node AND the unused .resume-preview h1 rule (in case a
  // future change reintroduces a body <h1>) so the two letter-spacing
  // values stay in lockstep.
  const name = previewArticle(page).locator('.resume-preview__contact-name').first();
  await expect(name).toBeVisible();
  const { letterSpacing, fontSize } = await name.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { letterSpacing: cs.letterSpacing, fontSize: cs.fontSize };
  });
  // -0.012em × fontSize. Browsers serialize as a px value; ratio it back
  // to em and check the magnitude is in the (−0.013, −0.011) range.
  const lsPx = Number.parseFloat(letterSpacing);
  const fontPx = Number.parseFloat(fontSize);
  const em = lsPx / fontPx;
  expect(em).toBeGreaterThan(-0.013);
  expect(em).toBeLessThan(-0.011);
});

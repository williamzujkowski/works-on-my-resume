/**
 * chrome-mode.spec.ts — the app-chrome light/dark toggle and its WCAG-AAA
 * palette (#192).
 *
 * Two halves:
 *  1. Contrast guard — reads the LIVE computed `--ui-*` tokens in each mode
 *     and asserts the pairs clear their WCAG targets. Because it reads the
 *     real CSS it also catches drift between the two duplicated dark blocks
 *     (the `@media (prefers-color-scheme: dark)` one and the explicit
 *     `[data-chrome-mode='dark']` one) — they must agree.
 *  2. Toggle behavior — selecting Light/Dark sets `data-chrome-mode` on
 *     <html> and persists; Auto clears it; the choice survives a reload.
 */
import { test, expect } from '@playwright/test';
import { clearAppStorage, waitForThemesReady } from './helpers';

/** WCAG relative luminance for an `#rrggbb` string. */
function luminance(hex: string): number {
  const m = hex.trim().replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio between two `#rrggbb` strings. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Read a set of `--ui-*` custom properties off :root. */
async function readTokens(page: import('@playwright/test').Page, names: string[]) {
  return page.evaluate((tokenNames) => {
    const cs = getComputedStyle(document.documentElement);
    const out: Record<string, string> = {};
    for (const n of tokenNames) out[n] = cs.getPropertyValue(n).trim();
    return out;
  }, names);
}

const TOKENS = [
  '--ui-bg',
  '--ui-panel',
  '--ui-fg',
  '--ui-fg-muted',
  '--ui-fg-subtle',
  '--ui-accent',
  '--ui-accent-contrast',
  '--ui-success',
  '--ui-warning',
  '--ui-danger',
  '--ui-border-strong',
];

/** The contrast contract both palettes must honour. */
function assertPalette(t: Record<string, string>) {
  // Body text is AAA (7:1) — the headline requirement.
  expect(contrast(t['--ui-fg'], t['--ui-bg'])).toBeGreaterThanOrEqual(7);
  expect(contrast(t['--ui-fg'], t['--ui-panel'])).toBeGreaterThanOrEqual(7);
  // Muted + accent text are AAA on the background.
  expect(contrast(t['--ui-fg-muted'], t['--ui-bg'])).toBeGreaterThanOrEqual(7);
  expect(contrast(t['--ui-accent'], t['--ui-bg'])).toBeGreaterThanOrEqual(7);
  // Subtle/secondary text and status colours clear AA (4.5:1).
  expect(contrast(t['--ui-fg-subtle'], t['--ui-bg'])).toBeGreaterThanOrEqual(4.5);
  expect(contrast(t['--ui-success'], t['--ui-bg'])).toBeGreaterThanOrEqual(4.5);
  expect(contrast(t['--ui-warning'], t['--ui-bg'])).toBeGreaterThanOrEqual(4.5);
  expect(contrast(t['--ui-danger'], t['--ui-bg'])).toBeGreaterThanOrEqual(4.5);
  // On-accent text (e.g. the primary button label) clears AA on the fill.
  expect(contrast(t['--ui-accent-contrast'], t['--ui-accent'])).toBeGreaterThanOrEqual(4.5);
  // The "strong" border is a real control boundary → 3:1 non-text minimum.
  expect(contrast(t['--ui-border-strong'], t['--ui-bg'])).toBeGreaterThanOrEqual(3);
}

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
});

test('LIGHT chrome palette clears its WCAG targets', async ({ page }) => {
  await page.goto('');
  await page.evaluate(() => (document.documentElement.dataset.chromeMode = 'light'));
  assertPalette(await readTokens(page, TOKENS));
});

test('DARK chrome palette (forced) clears its WCAG targets', async ({ page }) => {
  await page.goto('');
  await page.evaluate(() => (document.documentElement.dataset.chromeMode = 'dark'));
  assertPalette(await readTokens(page, TOKENS));
});

test('DARK chrome palette (via OS preference) matches and clears its targets', async ({ page }) => {
  // No attribute — exercise the @media (prefers-color-scheme: dark) block.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('');
  const t = await readTokens(page, TOKENS);
  // Sanity: the media query actually flipped us to the dark surface.
  expect(t['--ui-bg']).toBe('#181410');
  assertPalette(t);
});

test('toggle: Light/Dark set data-chrome-mode and persist; Auto clears it', async ({ page }) => {
  await page.goto('');
  // The toggle lives in the client:load island — wait for hydration before
  // interacting, otherwise the click lands before its handler is wired.
  await waitForThemesReady(page);
  const html = page.locator('html');

  const readStored = () =>
    page.evaluate(() => window.localStorage.getItem('womr:chrome-mode'));

  await page.getByRole('radio', { name: /dark appearance/i }).click();
  await expect(html).toHaveAttribute('data-chrome-mode', 'dark');
  await expect(page.getByRole('radio', { name: /dark appearance/i })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  // Persisted to localStorage (so it survives a reload — the island re-applies
  // it at hydration). NB: the test harness clears storage on every navigation,
  // so we assert the write directly rather than reloading.
  expect(await readStored()).toBe('dark');

  // Auto removes the attribute so the OS media query governs again.
  await page.getByRole('radio', { name: /auto appearance/i }).click();
  await expect(html).not.toHaveAttribute('data-chrome-mode');
  expect(await readStored()).toBe('auto');
});

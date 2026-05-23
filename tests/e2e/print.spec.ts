/**
 * print.spec.ts — print / "Save as PDF" CSS contract lock-in.
 *
 * Locks in the rules in `src/styles/print.css` against the two bug classes
 * reported by the user:
 *
 *   1. App chrome leaking into the printed page (toolbar, editor pane,
 *      shortcut legend, toasts, dialogs, the per-pane header dots).
 *   2. Resume content going *missing* in one of the two print modes —
 *      especially under the `modern` layout where the layout overlays carry
 *      decorative positioning that the print stylesheet has to neutralize
 *      without dropping content.
 *
 * No real PDFs are generated. We use Playwright's `page.emulateMedia({
 * media: 'print' })` to flip the viewport into print-rendering mode and
 * inspect the resulting computed styles. That is sufficient to validate the
 * `@media print { ... }` block — the same rules that the browser applies
 * when the user prints or saves to PDF.
 *
 * Print is a desktop concern; the mobile project skips this file.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  clearAppStorage,
  loadSampleResume,
  previewArticle,
  resetPrintMode,
  setPrintMode,
} from './helpers';

/**
 * Selectors for every piece of app chrome that print.css must hide.
 * Used by both the theme-mode and conservative-mode chrome-leak tests so the
 * "what is chrome?" definition lives in exactly one place.
 */
const CHROME_SELECTORS = [
  '.app-header',
  '.privacy-notice',
  '.studio__toolbar',
  '.studio__shortcuts',
  '.studio__pane--editor',
  '.studio__pane-header',
] as const;

/** Sample-resume section headings that MUST survive both print modes. */
const SAMPLE_SECTIONS = [
  'Summary',
  'Selected Impact',
  'Experience',
  'Education',
  'Skills',
] as const;

/* Print is a desktop concern. The mobile project still runs this file but
   every test below short-circuits — keeps the suite green without writing
   pointless mobile assertions for a feature mobile users do not exercise. */
test.skip(({ isMobile }) => isMobile === true, 'print is a desktop concern');

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
  await loadSampleResume(page);
});

test.afterEach(async ({ page }) => {
  await resetPrintMode(page);
});

/**
 * Assert that every element matched by `selector` is either absent from the
 * DOM or is computed `display: none` under the current media. Uses
 * `evaluateAll` so an empty match set is treated as a pass (the element is
 * not on the page at all — also fine).
 */
async function expectChromeHidden(page: Page, selector: string): Promise<void> {
  const states = await page.locator(selector).evaluateAll((nodes) =>
    nodes.map((el) => ({
      display: getComputedStyle(el).display,
      visibility: getComputedStyle(el).visibility,
    })),
  );
  for (const state of states) {
    expect.soft(state.display, `${selector} should be display:none in print`).toBe('none');
    // Belt-and-braces: visibility:hidden also leaks ink (transparent boxes
    // still take up page slots in some renderers), so any element that is
    // present must be display:none — visibility alone is not enough.
  }
}

/**
 * Assert a content element is genuinely rendered in print: not display:none,
 * not visibility:hidden, and the bounding box has positive height. The third
 * check catches the "section collapsed to zero" regression that a careless
 * print rule could introduce on layout overlays.
 */
async function expectContentVisible(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label} should exist`).toHaveCount(1, { timeout: 2000 });
  const box = await locator.evaluate((el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return { display: style.display, visibility: style.visibility, height: rect.height };
  });
  expect.soft(box.display, `${label} display`).not.toBe('none');
  expect.soft(box.visibility, `${label} visibility`).not.toBe('hidden');
  expect.soft(box.height, `${label} height > 0`).toBeGreaterThan(0);
}

/* ------------------------------------------------------------------ *
 * THEME print mode                                                    *
 * ------------------------------------------------------------------ */

test('theme print mode — no app chrome leaks into the printed page', async ({ page }) => {
  await setPrintMode(page, 'theme');

  for (const selector of CHROME_SELECTORS) {
    await expectChromeHidden(page, selector);
  }

  // Anything tagged with the explicit print-hide hook is a contract.
  await expectChromeHidden(page, '[data-print-hide]');

  // The toast and the keyboard-help dialog may or may not be mounted; we
  // assert they are hidden iff present. `expectChromeHidden` already handles
  // the empty-set case.
  await expectChromeHidden(page, '.toast');
  await expectChromeHidden(page, '.uploader__gist-preview');
  await expectChromeHidden(page, '[role="dialog"]');
});

test('theme print mode — resume content is visible', async ({ page }) => {
  await setPrintMode(page, 'theme');

  const article = previewArticle(page);
  await expectContentVisible(article, '.resume-preview');

  // Contact name from frontmatter — the canonical identity header.
  await expectContentVisible(article.getByText('Avery Quinn', { exact: true }).first(), 'name');

  // Every sample section heading is rendered.
  for (const section of SAMPLE_SECTIONS) {
    await expectContentVisible(
      article.getByRole('heading', { name: section, exact: true }),
      `heading: ${section}`,
    );
  }

  // The Skills table must survive — at least one header cell and one body
  // cell. `<th>` has role columnheader, `<td>` has role cell. We use the
  // canonical sample values so a future sample-content change surfaces at
  // the assertion level.
  await expectContentVisible(
    article.getByRole('columnheader', { name: 'Area', exact: true }),
    'skills table <th> Area',
  );
  await expectContentVisible(
    article.getByRole('cell', { name: /Go, TypeScript/i }).first(),
    'skills table <td> Languages row',
  );

  // Links remain present and carry their href. The contact-meta LinkedIn
  // link is a stable choice — it is in the sample frontmatter.
  const linkedin = article.getByRole('link', { name: /LinkedIn/i });
  await expectContentVisible(linkedin, 'LinkedIn link');
  await expect(linkedin).toHaveAttribute('href', 'https://www.linkedin.com/in/avery-quinn-example');
});

/* ------------------------------------------------------------------ *
 * CONSERVATIVE print mode (the default; covers a missing attribute)   *
 * ------------------------------------------------------------------ */

test('conservative print mode — no app chrome leaks into the printed page', async ({ page }) => {
  // Conservative is the default; setting `null` removes the attribute so we
  // also cover the "attribute missing" path that print.css's
  // `:not([data-print-mode='theme'])` selector relies on.
  await setPrintMode(page, null);

  for (const selector of CHROME_SELECTORS) {
    await expectChromeHidden(page, selector);
  }
  await expectChromeHidden(page, '[data-print-hide]');
  await expectChromeHidden(page, '.toast');
  await expectChromeHidden(page, '.uploader__gist-preview');
  await expectChromeHidden(page, '[role="dialog"]');
});

test('conservative print mode — resume is black-on-white with no theme accent leakage', async ({
  page,
}) => {
  await setPrintMode(page, 'conservative');

  const article = previewArticle(page);

  // The current theme's accent — captured from the live document — must NOT
  // be the color of any body text in print, because conservative mode pins
  // text to black. We snapshot the accent BEFORE the assertion so the test
  // is robust to whichever theme happens to be active at start (it is the
  // mount-time theme, which depends on user storage and could vary).
  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--resume-accent').trim(),
  );

  // The resume container must be (effectively) white.
  const bgRgb = await article.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bgRgb, 'resume preview background').toBe('rgb(255, 255, 255)');

  // Article text color is pinned to black.
  const articleColor = await article.evaluate((el) => getComputedStyle(el).color);
  expect(articleColor, 'resume preview color').toBe('rgb(0, 0, 0)');

  // Headings (h1, h2, h3) are all black.
  for (const tag of ['h1', 'h2', 'h3'] as const) {
    const headings = article.locator(tag);
    const count = await headings.count();
    if (count === 0) continue;
    const colors = await headings.evaluateAll((nodes) =>
      nodes.map((el) => getComputedStyle(el).color),
    );
    for (const color of colors) {
      expect.soft(color, `${tag} color in conservative print`).toBe('rgb(0, 0, 0)');
      // The current theme accent must NOT appear as a heading color. The
      // accent is in the `--resume-accent` custom property, expressed in
      // whatever form the theme uses (oklch, hex…); we compare the resolved
      // computed color string, so any token form that resolves to "not
      // black" would fail above already — this is a defensive cross-check.
      expect.soft(color, `${tag} must not be theme accent ${accent}`).not.toBe(accent);
    }
  }

  // Links in print are black and underlined.
  const link = article.getByRole('link', { name: /LinkedIn/i });
  const linkStyle = await link.evaluate((el) => ({
    color: getComputedStyle(el).color,
    textDecorationLine: getComputedStyle(el).textDecorationLine,
  }));
  expect(linkStyle.color, 'link color in conservative print').toBe('rgb(0, 0, 0)');
  expect(linkStyle.textDecorationLine, 'link must be underlined').toMatch(/underline/);
});

test('conservative print mode — every section heading and a body item under it are rendered', async ({
  page,
}) => {
  await setPrintMode(page, 'conservative');

  const article = previewArticle(page);
  await expectContentVisible(article, '.resume-preview');
  await expectContentVisible(article.getByText('Avery Quinn', { exact: true }).first(), 'name');

  // Every section heading is rendered.
  for (const section of SAMPLE_SECTIONS) {
    await expectContentVisible(
      article.getByRole('heading', { name: section, exact: true }),
      `heading: ${section}`,
    );
  }

  // One stable body anchor per section, drawn from the sample's actual text.
  // If any of these stops matching, the sample changed — update the list,
  // do NOT delete the assertion.
  const bodyAnchors: Array<{ text: RegExp; label: string }> = [
    { text: /eight years/i, label: 'Summary body' },
    { text: /Cut median CI time/i, label: 'Selected Impact bullet' },
    { text: /Northwind Logistics/i, label: 'Experience first role' },
    { text: /University of Oregon/i, label: 'Education school' },
    { text: /Kubernetes/i, label: 'Skills row content' },
  ];
  for (const { text, label } of bodyAnchors) {
    await expectContentVisible(article.getByText(text).first(), label);
  }

  // Skills table cells must render too — the user's bug report singled out
  // the table as one of the things that went missing in conservative print.
  // `<th>` is role columnheader; `<td>` is role cell.
  await expectContentVisible(
    article.getByRole('columnheader', { name: 'Area', exact: true }),
    'skills table <th> Area',
  );
  await expectContentVisible(
    article.getByRole('cell', { name: /Go, TypeScript/i }).first(),
    'skills table <td> Languages row',
  );
});

/* ------------------------------------------------------------------ *
 * Modern layout × conservative print                                  *
 * The PDF the user attached to the bug used the `modern` layout.      *
 * `resume.css` adds bespoke heading overlays / column rules to        *
 * `[data-template="modern"]`; this test re-runs the content matrix    *
 * against that layout to lock in that print does not eat the overlay  *
 * sections.                                                            *
 * ------------------------------------------------------------------ */

test('modern layout × conservative print — content is not missing', async ({ page }) => {
  // Switch to the modern layout via the URL so we are not waiting on the
  // LayoutSelector roles in this test. `?layout=` is the documented
  // permalink shape (ResumeStudio mounts read it on startup).
  await page.goto('?layout=modern');
  await loadSampleResume(page);

  // Sanity check: the article carries the right template attribute.
  const article = previewArticle(page);
  await expect(article).toHaveAttribute('data-template', 'modern');

  await setPrintMode(page, 'conservative');

  await expectContentVisible(article, '.resume-preview');
  await expectContentVisible(article.getByText('Avery Quinn', { exact: true }).first(), 'name');

  for (const section of SAMPLE_SECTIONS) {
    await expectContentVisible(
      article.getByRole('heading', { name: section, exact: true }),
      `[modern] heading: ${section}`,
    );
  }

  // Same body anchors as the conservative content test. If the modern-layout
  // overlay collapses any section to zero-height under print, one of these
  // will fail and we'll see exactly which one.
  const bodyAnchors: Array<{ text: RegExp; label: string }> = [
    { text: /eight years/i, label: '[modern] Summary body' },
    { text: /Cut median CI time/i, label: '[modern] Selected Impact bullet' },
    { text: /Northwind Logistics/i, label: '[modern] Experience first role' },
    { text: /University of Oregon/i, label: '[modern] Education school' },
    { text: /Kubernetes/i, label: '[modern] Skills row content' },
  ];
  for (const { text, label } of bodyAnchors) {
    await expectContentVisible(article.getByText(text).first(), label);
  }
});

/* ------------------------------------------------------------------ *
 * Standalone HTML export — sanity check                               *
 * Validates the OTHER artifact users get out of the studio: the       *
 * downloadable .html file built by `buildStandaloneHtml`.              *
 * ------------------------------------------------------------------ */

test('Download HTML export contains every section heading from the sample', async ({ page }) => {
  // Open the Export panel. Its trigger is the toolbar "Export" button.
  await page.getByRole('button', { name: /^export$/i }).click();

  // The Download HTML button lives inside the panel.
  const downloadButton = page.getByRole('button', { name: /download html/i });
  await expect(downloadButton).toBeVisible();

  // The export panel uses Blob URLs and a synthetic `<a download>` click —
  // Playwright surfaces this as a `download` event on the page.
  const [download] = await Promise.all([page.waitForEvent('download'), downloadButton.click()]);

  const stream = await download.createReadStream();
  let html = '';
  for await (const chunk of stream) {
    html += chunk.toString();
  }

  // The filename is `<name>-resume.html`.
  expect(download.suggestedFilename()).toMatch(/-resume\.html$/);

  // Every sample section heading must appear in the exported HTML body.
  for (const section of SAMPLE_SECTIONS) {
    expect.soft(html, `exported HTML contains "${section}"`).toContain(`>${section}<`);
  }

  // And the canonical identity (frontmatter name) is in the export — the
  // header lives outside the body HTML, so check the document at large.
  expect(html).toContain('Avery Quinn');
});

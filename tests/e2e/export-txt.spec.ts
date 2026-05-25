/**
 * export-txt.spec.ts — plain-text export (#110).
 *
 * Locks in the contract for the new "Download plain text (.txt)" button:
 *
 *   1. Clicking it triggers a file download named `<slug>-resume.txt`.
 *   2. The downloaded text contains the candidate's name and at least one
 *      role title pulled from the rendered preview.
 *   3. The downloaded text contains NO HTML angle brackets and NO markdown
 *      asterisks — the two giveaways that an ATS-hostile artifact slipped
 *      through. The text is a `.textContent` walk of the rendered preview,
 *      same trust boundary the Tailor matcher uses.
 *
 * No assertions about pixel layout or whitespace counts: the spec is the
 * SAFETY contract (no angle brackets, no markdown decoration) plus an
 * existence check on canonical resume text.
 */
import { test, expect } from '@playwright/test';
import {
  clearAppStorage,
  loadSampleResume,
  openMobileMoreMenu,
  waitForThemesReady,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
  await loadSampleResume(page);
  /* The Export panel does not depend on theme data, but the panel positions
     itself relative to the toolbar — wait for the themes-ready signal so the
     toolbar layout is settled before we click. Cheap insurance against
     flakiness on cold-cache CI runs (#80). */
  await waitForThemesReady(page);
});

/**
 * Open the Export panel, click "Download plain text", and return both the
 * downloaded body and the suggested filename. Centralizes the Playwright
 * `download` event dance so the assertions read like prose.
 */
async function downloadPlainTextBody(
  page: import('@playwright/test').Page,
): Promise<{ text: string; filename: string }> {
  /* Mobile (#131): Export sits inside the collapsed More menu on
     viewports < 640 px; open the drawer first if the trigger isn't
     immediately visible. */
  const exportTrigger = page.getByRole('button', { name: /^export$/i });
  if (!(await exportTrigger.isVisible())) {
    await openMobileMoreMenu(page);
  }
  await exportTrigger.click();

  const downloadButton = page.getByRole('button', { name: /download plain text/i });
  await expect(downloadButton).toBeVisible();

  /* The export panel uses Blob URLs and a synthetic `<a download>` click —
     Playwright surfaces this as a `download` event on the page. */
  const [download] = await Promise.all([page.waitForEvent('download'), downloadButton.click()]);

  const stream = await download.createReadStream();
  let text = '';
  for await (const chunk of stream) {
    text += chunk.toString();
  }
  return { text, filename: download.suggestedFilename() };
}

test('Download plain text export contains the candidate name and role from the sample', async ({
  page,
}) => {
  const { text, filename } = await downloadPlainTextBody(page);

  /* Filename follows the same `<slug>-resume.<ext>` precedent as Markdown
     and HTML exports — slug derived from the frontmatter name. */
  expect(filename).toMatch(/-resume\.txt$/);

  /* The candidate's name appears at the top of the document — we render it
     uppercased per the formatting contract. */
  expect(text).toContain('AVERY QUINN');
  /* And the role title appears as the second line, verbatim from the
     `.resume-preview__contact-role` paragraph. */
  expect(text).toMatch(/Senior Platform Engineer|Staff Software Engineer/);
});

test('Download plain text export contains canonical section headings, uppercased', async ({
  page,
}) => {
  const { text } = await downloadPlainTextBody(page);

  /* `buildPlainText` collapses every body heading (h2/h3/h4) to a single
     uppercase line. The sample's top-level sections must all be present. */
  for (const section of ['SUMMARY', 'SELECTED IMPACT', 'EXPERIENCE', 'EDUCATION', 'SKILLS']) {
    expect.soft(text, `plain-text export contains "${section}"`).toContain(section);
  }
});

test('Download plain text export contains NO HTML angle brackets or markdown decoration', async ({
  page,
}) => {
  const { text } = await downloadPlainTextBody(page);

  /* The crucial safety contract for legacy ATS: the file is plain text.
     Angle brackets would indicate raw HTML leaking through; double asterisks
     would indicate raw Markdown — both signal a broken pipeline. */
  expect(text).not.toContain('<');
  expect(text).not.toContain('>');
  expect(text).not.toContain('**');

  /* Defense in depth: backtick code spans should be flattened too. The
     sample has a `cache-key` token inside a paragraph — it should appear
     as plain text, with no surrounding backticks. */
  expect(text).toContain('cache-key');
  expect(text).not.toContain('`cache-key`');
});

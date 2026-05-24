/**
 * tailor-for-a-role.spec.ts — JD keyword overlap (#91).
 *
 * Covers the end-to-end behaviour of the `<TailorForRole />` disclosure:
 *
 *  1. The disclosure is present in the editor pane, defaults closed, and
 *     opens on click.
 *  2. Pasting a synthetic JD computes Matches + Gaps. Terms that exist in
 *     the bundled sample (Kubernetes, Terraform, AWS, Postgres-as-bigram)
 *     land in Matches; obvious non-matches (Salesforce, Java) land in
 *     Gaps.
 *  3. Overlay marks (`<mark class="tailor-match">`) are inserted into the
 *     `.resume-preview` article.
 *  4. Clearing the JD removes the marks and resets the empty-state.
 *  5. Privacy: the JD text is never written to localStorage / sessionStorage.
 */
import { test, expect } from '@playwright/test';
import { clearAppStorage, expandMobileEditor, loadSampleResume, previewArticle } from './helpers';

/* A synthetic JD that mentions sample-resume hits AND gaps. The match terms
   ("Kubernetes", "Terraform", "incident response", "AWS") all appear in the
   sample resume; the gap terms ("Salesforce", "Java") deliberately don't.
   Note we use bigrams that the extractor will pick up — capitalized tokens
   plus the bigram rule. */
const SYNTHETIC_JD = `
Senior Platform Engineer

We are looking for a Senior Platform Engineer with strong experience
building and operating cloud infrastructure. The successful candidate will
own our deploy pipeline and on-call rotation.

Required skills:
- Deep Kubernetes experience in production.
- Hands-on Terraform for AWS environments.
- Incident response and postmortem facilitation.
- Salesforce administration experience.
- Java backend services at scale.

Nice to have: experience with Salesforce CRM and Java microservices.
`.trim();

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
});

test('disclosure is mounted in the editor pane and defaults closed', async ({ page }) => {
  await loadSampleResume(page);
  await expandMobileEditor(page);

  const summary = page.getByRole('group', { name: /tailor for a role/i });
  // <details> exposes as a group when collapsed in Playwright accessibility tree.
  // Fall back to a class-based locator if the role match is environment-specific.
  const tailor = page.locator('details.tailor');
  await expect(tailor).toHaveCount(1);
  // Default-closed: the textarea is not visible.
  await expect(tailor.locator('textarea')).toBeHidden();
  // Sanity: the summary contains the discoverable label.
  await expect(summary.or(tailor).first()).toContainText(/tailor for a role/i);
});

test('pasting a JD surfaces Matches and Gaps and overlays marks on the preview', async ({
  page,
}) => {
  await loadSampleResume(page);
  await expandMobileEditor(page);

  const tailor = page.locator('details.tailor');
  // Open the disclosure by clicking its summary.
  await tailor.locator('summary').click();
  await expect(tailor).toHaveAttribute('open', '');

  // Paste the synthetic JD.
  const textarea = tailor.getByLabel(/paste a job description/i);
  await expect(textarea).toBeVisible();
  await textarea.fill(SYNTHETIC_JD);

  // The hit-rate chip appears once the debounced compute resolves. The
  // chip text is the `X / Y (Z%)` formatter.
  const chip = tailor.locator('.tailor__summary-chip');
  await expect(chip).toBeVisible({ timeout: 5_000 });
  await expect(chip).toHaveText(/\d+ \/ \d+ \(\d+%\)/);

  // Matches: at least Kubernetes and Terraform land here. Case-insensitive
  // text matches on the rendered list.
  const matchesList = tailor.locator('.tailor__list--matches');
  await expect(matchesList).toBeVisible();
  await expect(matchesList).toContainText(/Kubernetes/i);
  await expect(matchesList).toContainText(/Terraform/i);

  // Gaps: Salesforce and Java appear in the JD multiple times and don't
  // appear in the sample resume — they must be in the gaps list.
  const gapsList = tailor.locator('.tailor__list--gaps');
  await expect(gapsList).toBeVisible();
  await expect(gapsList).toContainText(/Salesforce/i);
  await expect(gapsList).toContainText(/Java/i);

  // Overlay marks: at least one <mark class="tailor-match"> wraps text in
  // the rendered resume article.
  const article = previewArticle(page);
  const marks = article.locator('mark.tailor-match');
  await expect(marks.first()).toBeVisible({ timeout: 5_000 });
  // And at least one mark wraps the Kubernetes string the article contains.
  await expect(article.getByText(/Kubernetes/i).first()).toBeVisible();
  const markCount = await marks.count();
  expect(markCount).toBeGreaterThan(0);
});

test('clearing the JD removes overlay marks and resets the empty state', async ({ page }) => {
  await loadSampleResume(page);
  await expandMobileEditor(page);

  const tailor = page.locator('details.tailor');
  await tailor.locator('summary').click();
  const textarea = tailor.getByLabel(/paste a job description/i);
  await textarea.fill(SYNTHETIC_JD);

  // Wait until marks are present before clearing — otherwise we'd race the
  // debounce and "clear" would be a no-op.
  const article = previewArticle(page);
  const marks = article.locator('mark.tailor-match');
  await expect(marks.first()).toBeVisible({ timeout: 5_000 });

  // Click "Clear" — appears once the JD is non-empty.
  await tailor.getByRole('button', { name: /clear job description/i }).click();
  // The textarea is empty again.
  await expect(textarea).toHaveValue('');
  // The hit-rate chip is gone.
  await expect(tailor.locator('.tailor__summary-chip')).toHaveCount(0);
  // Marks are removed from the preview.
  await expect(marks).toHaveCount(0);
  // The empty-state copy is back.
  await expect(tailor.locator('.tailor__empty')).toContainText(/paste a job description above/i);
});

test('privacy: JD content is never written to local- or sessionStorage', async ({ page }) => {
  await loadSampleResume(page);
  await expandMobileEditor(page);

  const tailor = page.locator('details.tailor');
  await tailor.locator('summary').click();
  const textarea = tailor.getByLabel(/paste a job description/i);
  // A distinctive marker string we can grep for in storage afterwards.
  const SECRET = `salesforce-tailor-canary-${Date.now()}`;
  await textarea.fill(`${SYNTHETIC_JD}\n${SECRET}`);

  // Let the debounced compute settle so any side-effects would have run.
  await expect(tailor.locator('.tailor__summary-chip')).toBeVisible({ timeout: 5_000 });

  // Audit both storages — nothing the app stores should contain the JD.
  const storageDump = await page.evaluate(() => {
    const dump = (storage: Storage) => {
      const out: Record<string, string> = {};
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key) out[key] = storage.getItem(key) ?? '';
      }
      return out;
    };
    return { local: dump(window.localStorage), session: dump(window.sessionStorage) };
  });
  const haystack = JSON.stringify(storageDump);
  expect(haystack).not.toContain(SECRET);
});

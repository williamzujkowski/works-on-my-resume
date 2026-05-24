/**
 * journey.spec.ts — the Phase 1 → Phase 2 flow.
 *
 * Validates the two-phase journey called out in ResumeStudio's docs:
 *   - Phase 1 (no resume loaded): uploader is the hero, the theme toolbar
 *     and shortcut chip are NOT in the DOM.
 *   - Phase 2 (resume loaded): the toolbar (including the shortcut chip)
 *     appears, the resume is rendered.
 *   - Clear: returns to Phase 1.
 *
 * The shortcut affordance is the `shortcuts (?)` chip on the right edge of
 * the toolbar (#99) — it replaces the legacy "Shortcuts" legend row.
 */
import { test, expect } from '@playwright/test';
import { clearAppStorage, loadSampleResume } from './helpers';

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
});

test('phase 1: toolbar and shortcut chip are absent until a resume is loaded', async ({ page }) => {
  // The empty-state preview is the giveaway that we are in Phase 1.
  await expect(page.getByText(/no resume loaded yet/i)).toBeVisible();

  // The theme picker trigger and Export button live in the Phase 2 toolbar.
  await expect(page.getByRole('button', { name: /^theme /i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^export$/i })).toHaveCount(0);

  // The shortcut chip (#99) is the toolbar's discoverable shortcut affordance.
  await expect(page.locator('.studio__shortcuts-chip')).toHaveCount(0);

  // The uploader's hero affordance — "Load sample" and "Choose file" — IS present.
  await expect(page.getByRole('button', { name: /load sample/i })).toBeVisible();
});

test('phase 2: loading the sample reveals the toolbar, shortcut chip, and rendered resume', async ({
  page,
}) => {
  await loadSampleResume(page);

  // Rendered resume content — scope "Avery Quinn" to the preview article,
  // since the same string also appears in the editor textarea.
  const article = page.getByRole('article', { name: /rendered resume/i });
  await expect(article).toBeVisible();
  await expect(article.getByText('Avery Quinn')).toBeVisible();

  // Toolbar now mounted.
  await expect(page.getByRole('button', { name: /^theme /i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^export$/i })).toBeVisible();

  // Shortcut chip now mounted. The trigger is visible on fine-pointer devices;
  // assert its presence in the DOM (the `pointer: coarse` media hides it on
  // mobile but the element is still attached).
  await expect(page.locator('.studio__shortcuts-chip')).toHaveCount(1);
});

test('faded sample preview (#96): empty pane renders the bundled sample dimmed with a "Try the sample" CTA', async ({
  page,
}) => {
  // Phase 1: no resume loaded. The faded preview lives inside the preview
  // pane; the fetch runs on mount, so the faded article appears once the
  // sample-resume.md asset is in.
  const fadedArticle = page.locator('.faded-sample .resume-preview');
  await expect(fadedArticle).toBeVisible({ timeout: 10_000 });
  // The faded layer's content is the bundled sample — Avery Quinn is the
  // canonical identity in public/sample-resume.md.
  await expect(fadedArticle.getByText('Avery Quinn')).toBeVisible();

  // The CTA overlay carries the headline + "Try the sample" button.
  await expect(page.getByText(/live preview will appear here/i)).toBeVisible();
  const cta = page.getByRole('button', { name: /try the sample/i });
  await expect(cta).toBeVisible();

  // The faded layer is decorative — aria-hidden — so AT users don't hear
  // the dimmed sample as if it were a real loaded resume.
  await expect(page.locator('.faded-sample__layer')).toHaveAttribute('aria-hidden', 'true');

  // The overlay layer must NOT eat the button click — it's set to
  // pointer-events: none so the inner button remains the only interactive
  // target. Clicking the CTA routes through onLoad and transitions to
  // Phase 2.
  await cta.click();
  const realArticle = page.getByRole('article', { name: /rendered resume/i });
  await expect(realArticle).toBeVisible();
  await expect(realArticle.getByText('Avery Quinn')).toBeVisible();
  // And the faded variant is gone — the empty state has been replaced by
  // the real loaded preview.
  await expect(page.locator('.faded-sample')).toHaveCount(0);
});

test('clear: returns to the empty Phase 1 state', async ({ page }) => {
  await loadSampleResume(page);

  await page.getByRole('button', { name: /^clear$/i }).click();

  // Empty-state restored. After #96 the empty preview is the faded sample
  // (with its "Try the sample" CTA) when the bundled sample fetch
  // succeeded, or the legacy "No resume loaded yet" message otherwise.
  // Accept either so the test stays green on a cold network too.
  await expect(
    page
      .getByRole('button', { name: /try the sample/i })
      .or(page.getByText(/no resume loaded yet/i)),
  ).toBeVisible();
  // The REAL preview article (`role="article"` with the rendered-resume
  // label) no longer exists, and the editor textarea is cleared. The
  // faded variant uses a separate root, so it does not satisfy this
  // locator even when present.
  await expect(page.getByRole('article', { name: /rendered resume/i })).toHaveCount(0);
  await expect(page.getByLabel(/markdown source/i)).toHaveValue('');

  // Toolbar + shortcut chip gone.
  await expect(page.getByRole('button', { name: /^theme /i })).toHaveCount(0);
  await expect(page.locator('.studio__shortcuts-chip')).toHaveCount(0);
});

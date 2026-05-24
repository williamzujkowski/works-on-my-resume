/**
 * snapshots.spec.ts — resume version snapshots (#94).
 *
 * The Snapshots dropdown lets a user save a local point-in-time copy of
 * their resume so they can A/B between (say) "applying to Stripe" and
 * "applying to a startup" without copy-pasting Markdown. Behaviour under
 * test:
 *
 *  1. Gate: with draft autosave OFF, the trigger is disabled and carries
 *     the "Enable Remember this resume…" tooltip. The privacy invariant
 *     from #32 must hold.
 *  2. Save round-trip: enabling autosave, saving a snapshot, then loading
 *     a different resume and clicking Load restores the saved Markdown.
 *  3. Cap: the 11th save evicts the oldest, so the visible count never
 *     exceeds 10 (enforced server-side in `saveSnapshot`).
 *  4. Delete: removing a snapshot updates the count immediately and the
 *     row disappears.
 */
import { test, expect } from '@playwright/test';
import { clearAppStorage, expandMobileEditor, loadSampleResume } from './helpers';

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
});

test('gate: with draft autosave OFF the Snapshots trigger is disabled and the privacy hint is exposed', async ({
  page,
}) => {
  await loadSampleResume(page);

  // The trigger button is in the DOM but `disabled`. We assert on the
  // `disabled` attribute rather than visibility because it's still rendered
  // so the affordance is discoverable.
  const trigger = page.getByRole('button', { name: /Snapshots \(0\)/i });
  await expect(trigger).toBeDisabled();

  // The aria-label carries the explanatory hint so AT users hear the
  // gating reason — `title` is also set for sighted users, but only the
  // aria-label is reliably exposed across browsers/playwright.
  await expect(trigger).toHaveAttribute(
    'aria-label',
    /Enable Remember this resume on this device to use snapshots/i,
  );
});

test('save round-trip: snapshot the sample, replace the body, then Load restores it', async ({
  page,
}) => {
  await loadSampleResume(page);

  // Enable draft autosave (the snapshots gate).
  // On mobile (#100) the editor pane (which holds the draft-toggle gate)
  // collapses once a resume is loaded — expand it so the checkbox is
  // actually visible to Playwright.
  await expandMobileEditor(page);
  // The "Remember this resume on this device" checkbox is the snapshots
  // gate. Locate via the surrounding draft-toggle container — using
  // getByRole('checkbox', ...) with a name regex is brittle because the
  // computed accessible name includes the long hint copy.
  await page.locator('.studio__draft-toggle input[type="checkbox"]').check();

  // Open the Snapshots popover and confirm the default save name reflects
  // the resume's frontmatter.name (Avery Quinn in the bundled sample).
  await page.getByRole('button', { name: /Snapshots \(0\)/i }).click();
  const dialog = page.getByRole('dialog', { name: /Save snapshot/i });
  await expect(dialog).toBeVisible();

  const nameInput = dialog.getByLabel(/Snapshot name/i);
  // The seed name includes the contact name from the sample resume.
  await expect(nameInput).toHaveValue(/Avery Quinn/);

  // Pick a deterministic name we can search for after reload.
  await nameInput.fill('Stripe pass');
  await dialog.getByRole('button', { name: /^Save$/ }).click();

  // The list row should appear with our name. Close the popover so it
  // doesn't intercept the next click.
  await expect(dialog.getByText('Stripe pass')).toBeVisible();
  await page.keyboard.press('Escape');

  // The trigger count updates.
  await expect(page.getByRole('button', { name: /Snapshots \(1\)/i })).toBeVisible();

  // Now wreck the editor body so loading the snapshot has something to
  // restore from. The textarea is the canonical edit surface.
  const textarea = page.getByLabel(/markdown source/i);
  await textarea.fill('# Not Avery Quinn\n\nA different resume entirely.');

  // The preview should reflect the replaced body — Avery is no longer in
  // the rendered article.
  const article = page.getByRole('article', { name: /rendered resume/i });
  await expect(article.getByText('Not Avery Quinn')).toBeVisible();

  // Reopen and Load the snapshot. Avery is back.
  await page.getByRole('button', { name: /Snapshots \(1\)/i }).click();
  const reopened = page.getByRole('dialog', { name: /Save snapshot/i });
  await reopened.getByRole('button', { name: /^Load snapshot Stripe pass$/ }).click();
  await expect(article.getByText('Avery Quinn')).toBeVisible({ timeout: 5_000 });
});

test('cap: saving 11 snapshots keeps the visible count at 10 (oldest evicted)', async ({
  page,
}) => {
  await loadSampleResume(page);
  // On mobile (#100) the editor pane (which holds the draft-toggle gate)
  // collapses once a resume is loaded — expand it so the checkbox is
  // actually visible to Playwright.
  await expandMobileEditor(page);
  // The "Remember this resume on this device" checkbox is the snapshots
  // gate. Locate via the surrounding draft-toggle container — using
  // getByRole('checkbox', ...) with a name regex is brittle because the
  // computed accessible name includes the long hint copy.
  await page.locator('.studio__draft-toggle input[type="checkbox"]').check();

  // Save 11 snapshots, naming each so we can verify which one was evicted.
  await page.getByRole('button', { name: /Snapshots \(0\)/i }).click();
  const dialog = page.getByRole('dialog', { name: /Save snapshot/i });
  const nameInput = dialog.getByLabel(/Snapshot name/i);
  const saveBtn = dialog.getByRole('button', { name: /^Save$/ });

  for (let i = 1; i <= 11; i += 1) {
    await nameInput.fill(`snap-${i.toString().padStart(2, '0')}`);
    await saveBtn.click();
    // Brief wait so each save lands a distinct `savedAt` ms — otherwise
    // the eviction order is technically unstable across ties.
    await page.waitForTimeout(15);
  }

  // The count tops out at 10 (cap enforced in storage.ts saveSnapshot).
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Snapshots \(10\)/i })).toBeVisible();

  // Reopen the dialog and verify the oldest (snap-01) is gone and the
  // newest (snap-11) is present.
  await page.getByRole('button', { name: /Snapshots \(10\)/i }).click();
  const reopened = page.getByRole('dialog', { name: /Save snapshot/i });
  await expect(reopened.getByText('snap-11')).toBeVisible();
  await expect(reopened.getByText('snap-01')).toHaveCount(0);
});

test('delete: removing a snapshot decrements the count and removes the row', async ({ page }) => {
  await loadSampleResume(page);
  // On mobile (#100) the editor pane (which holds the draft-toggle gate)
  // collapses once a resume is loaded — expand it so the checkbox is
  // actually visible to Playwright.
  await expandMobileEditor(page);
  // The "Remember this resume on this device" checkbox is the snapshots
  // gate. Locate via the surrounding draft-toggle container — using
  // getByRole('checkbox', ...) with a name regex is brittle because the
  // computed accessible name includes the long hint copy.
  await page.locator('.studio__draft-toggle input[type="checkbox"]').check();

  // Save two snapshots so we have something to delete and something to keep.
  await page.getByRole('button', { name: /Snapshots \(0\)/i }).click();
  const dialog = page.getByRole('dialog', { name: /Save snapshot/i });
  const nameInput = dialog.getByLabel(/Snapshot name/i);
  const saveBtn = dialog.getByRole('button', { name: /^Save$/ });

  await nameInput.fill('keep me');
  await saveBtn.click();
  await page.waitForTimeout(20);
  await nameInput.fill('delete me');
  await saveBtn.click();

  // Delete the "delete me" row. The button is labelled aria-label="Delete
  // snapshot delete me".
  await dialog.getByRole('button', { name: /Delete snapshot delete me/i }).click();

  // The list row is gone; "keep me" remains.
  await expect(dialog.getByText('delete me')).toHaveCount(0);
  await expect(dialog.getByText('keep me')).toBeVisible();

  // And the trigger count drops to 1.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Snapshots \(1\)/i })).toBeVisible();
});

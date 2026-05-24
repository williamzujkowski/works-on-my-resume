/**
 * health.spec.ts — Resume Health panel (#85).
 *
 * The panel itself is shipped by this turn, but the integration agent wires
 * it into ResumeStudio and adds the panel's CSS in `global.css`. Tests that
 * exercise the rendered panel in-app are gated with `test.fixme` and will
 * be flipped on once the panel is mounted by the studio.
 *
 * A `test.fixme` is a test that's KNOWN to be skipped — Playwright reports
 * it distinctly from a pass, so the integration agent has a single grep
 * target to flip and re-run the suite.
 */
import { test, expect } from '@playwright/test';
import { clearAppStorage, loadSampleResume } from './helpers';

/** Convenience locator for the Resume Health section once it's mounted. */
function healthPanel(page: import('@playwright/test').Page) {
  return page.getByRole('region', { name: /resume health/i });
}

/**
 * Activate the Health tab in the preview pane. The tab default is Preview,
 * so every test that asserts on the Health panel begins by switching.
 *
 * Idempotent: if a previous step already activated the tab the second click
 * is harmless.
 */
async function openHealthTab(page: import('@playwright/test').Page) {
  await page.getByRole('tab', { name: /^health$/i }).click();
}

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
});

/* ------------------------------------------------------------------ */
/* 1. Empty state                                                      */
/* ------------------------------------------------------------------ */
test('renders the empty-state copy when no resume is loaded', async ({ page }) => {
  // Switch to the Health tab without first loading a resume.
  await openHealthTab(page);
  const panel = healthPanel(page);
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(/load a resume to see health feedback/i);
});

/* ------------------------------------------------------------------ */
/* 2. Sample resume scoring (senior)                                   */
/* ------------------------------------------------------------------ */
test('scores the sample resume above 60 at the senior stage', async ({ page }) => {
  await loadSampleResume(page);
  await openHealthTab(page);

  // Default stage is `mid`, so switch to senior first.
  const panel = healthPanel(page);
  await panel.getByRole('radio', { name: /^senior$/i }).click();

  // The score is rendered as a number inside `.health__score-num`.
  // The aria-label encodes the same number for assertion ergonomics.
  const score = panel.locator('.health__score-num');
  await expect(score).toBeVisible();
  const value = Number(((await score.textContent()) ?? '').trim());
  expect(Number.isFinite(value)).toBe(true);
  expect(value).toBeGreaterThan(60);

  // Sample is clean on weak-verb and first-person — make sure no finding
  // from those rules surfaced.
  const list = panel.locator('.health__list');
  if (await list.count()) {
    await expect(list.locator('[data-rule="weak-verb"]')).toHaveCount(0);
    await expect(list.locator('[data-rule="first-person"]')).toHaveCount(0);
  }
});

/* ------------------------------------------------------------------ */
/* 3. Stage sensitivity                                                */
/* ------------------------------------------------------------------ */
test('score drops when the user switches from senior to junior', async ({ page }) => {
  await loadSampleResume(page);
  await openHealthTab(page);
  const panel = healthPanel(page);

  await panel.getByRole('radio', { name: /^senior$/i }).click();
  const seniorScore = Number(
    ((await panel.locator('.health__score-num').textContent()) ?? '').trim(),
  );

  await panel.getByRole('radio', { name: /^junior$/i }).click();
  const juniorScore = Number(
    ((await panel.locator('.health__score-num').textContent()) ?? '').trim(),
  );

  expect(juniorScore).toBeLessThan(seniorScore);

  // The length finding should now exist at `bad` severity. It carries no
  // line, so the dot's container is matched on `data-rule`.
  const lengthFinding = panel.locator('.health__list [data-rule="length"]');
  await expect(lengthFinding).toHaveCount(1);
  await expect(lengthFinding).toHaveClass(/health__item--bad/);
});

/* ------------------------------------------------------------------ */
/* 4. Weak-verb detection + jump handler                               */
/* ------------------------------------------------------------------ */
test('weak-verb finding fires for a bullet starting with "Responsible for"', async ({ page }) => {
  // Capture jump invocations on the page object so the test can assert one
  // fired with the expected line number. The integration agent owns the
  // wiring of `onJumpToLine`; if it forwards the call to a globally-listenable
  // hook (e.g. dispatching a custom event), the test can listen and assert
  // directly. Until then, asserting on the rendered "Jump to line N" button
  // is sufficient evidence the finding carries a `line`.
  const md = [
    '---',
    'name: Test User',
    'role: Engineer',
    'email: test@example.com',
    'links:',
    '  - GitHub: https://example.com',
    '---',
    '',
    '## Summary',
    '',
    'Body text so the preview renders.',
    '',
    '## Experience',
    '',
    '### Engineer — Acme',
    '',
    '- Responsible for managing the team.',
    '- Shipped a feature that mattered.',
    '- Built another nice thing.',
    '',
    '## Skills',
    '',
    '- Things',
    '',
  ].join('\n');

  await page.getByLabel(/markdown source/i).fill(md);
  // The parser is debounced 200 ms; wait until the preview rerenders.
  await expect(page.getByRole('article', { name: /rendered resume/i })).toBeVisible();
  await openHealthTab(page);

  const panel = healthPanel(page);
  const finding = panel.locator('.health__list [data-rule="weak-verb"]');
  await expect(finding).toHaveCount(1);
  // The "Responsible for" bullet is on line 17 of the markdown above.
  await expect(finding.getByRole('button', { name: /jump to line 17/i })).toBeVisible();
});

/* ------------------------------------------------------------------ */
/* 5. First-person detection                                           */
/* ------------------------------------------------------------------ */
test('first-person finding fires for a bullet starting with "I led"', async ({ page }) => {
  const md = [
    '---',
    'name: Test User',
    'role: Engineer',
    'email: test@example.com',
    'links:',
    '  - GitHub: https://example.com',
    '---',
    '',
    '## Summary',
    '',
    'Body text so the preview renders.',
    '',
    '## Experience',
    '',
    '### Engineer — Acme',
    '',
    '- I led the migration to a new platform.',
    '- Shipped a feature that mattered.',
    '- Built another nice thing.',
    '',
    '## Skills',
    '',
    '- Things',
    '',
  ].join('\n');

  await page.getByLabel(/markdown source/i).fill(md);
  await expect(page.getByRole('article', { name: /rendered resume/i })).toBeVisible();
  await openHealthTab(page);

  const panel = healthPanel(page);
  const finding = panel.locator('.health__list [data-rule="first-person"]');
  await expect(finding).toHaveCount(1);
  await expect(finding.getByRole('button', { name: /jump to line 17/i })).toBeVisible();
});

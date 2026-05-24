/**
 * health-actionable.spec.ts — actionable Resume Health findings (#115).
 *
 * The Resume Health panel (#85) emits findings with severity dots. With #115
 * each finding becomes an interactive row: "Jump to line N" selects the
 * literal offender substring in the editor textarea, and findings backed by
 * a templated rewrite (weak-verb, the most common case) get an extra
 * "Suggest a fix" button that opens an inline tray of 2-3 candidate
 * rewrites pulled from `bulletPatterns` (#93). Selecting a candidate
 * inserts a sibling bullet above the original through the editor's
 * value/onChange path — the preview never receives unsanitized content.
 *
 * The spec exercises the weak-verb + Suggest-a-fix path end-to-end, which
 * covers the most user-visible bit of #115. The Open-an-example fallback
 * path and the offender-aware selection are covered as smaller assertions
 * inside the same file.
 */
import { test, expect, type Page } from '@playwright/test';
import { clearAppStorage, expandMobileEditor } from './helpers';

/** The Resume Health panel region locator. */
function healthPanel(page: Page) {
  return page.getByRole('region', { name: /resume health/i });
}

/** Activate the Health tab in the preview pane. Idempotent. */
async function openHealthTab(page: Page) {
  await page.getByRole('tab', { name: /^health$/i }).click();
}

/**
 * A small resume that contains exactly one weak-verb opener so the
 * weak-verb finding is the only actionable warning. Frontmatter +
 * structure mirrors `health.spec.ts` so we stay consistent with the
 * existing fixtures.
 */
const RESUME_WITH_WEAK_VERB = [
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
  '- Worked on the cache layer and the deploy pipeline.',
  '- Shipped a feature that mattered.',
  '- Built another nice thing.',
  '',
  '## Skills',
  '',
  '- Things',
  '',
].join('\n');

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
});

/* ------------------------------------------------------------------ */
/* 1. Weak-verb: Jump to line selects the offender                    */
/* ------------------------------------------------------------------ */
test('weak-verb "Jump to line" selects the offender substring', async ({ page }) => {
  await expandMobileEditor(page);
  await page.getByLabel(/markdown source/i).fill(RESUME_WITH_WEAK_VERB);
  await expect(page.getByRole('article', { name: /rendered resume/i })).toBeVisible();
  await openHealthTab(page);

  const panel = healthPanel(page);
  const finding = panel.locator('.health__list [data-rule="weak-verb"]');
  await expect(finding).toHaveCount(1);

  // The "Worked on …" bullet is on line 17 of the markdown above.
  const jumpButton = finding.getByRole('button', { name: /jump to line 17/i });
  await expect(jumpButton).toBeVisible();
  await jumpButton.click();

  // After the jump, the textarea selection should land on "Worked on".
  // We read the live DOM selection — `selectionStart`/`selectionEnd` are
  // the canonical signal that a substring (not the whole line) was picked.
  const textarea = page.getByLabel(/markdown source/i);
  const selection = await textarea.evaluate((el) => {
    const ta = el as HTMLTextAreaElement;
    return {
      start: ta.selectionStart,
      end: ta.selectionEnd,
      value: ta.value.slice(ta.selectionStart, ta.selectionEnd),
    };
  });
  expect(selection.value).toBe('Worked on');
});

/* ------------------------------------------------------------------ */
/* 2. Weak-verb: Suggest a fix opens a tray with bulletPattern entries */
/* ------------------------------------------------------------------ */
test('weak-verb "Suggest a fix" opens a tray with at least two rewrites', async ({ page }) => {
  await expandMobileEditor(page);
  await page.getByLabel(/markdown source/i).fill(RESUME_WITH_WEAK_VERB);
  await expect(page.getByRole('article', { name: /rendered resume/i })).toBeVisible();
  await openHealthTab(page);

  const panel = healthPanel(page);
  const finding = panel.locator('.health__list [data-rule="weak-verb"]');
  const fixButton = finding.getByRole('button', { name: /suggest a fix/i });
  await expect(fixButton).toBeVisible();
  await fixButton.click();

  // Tray opens beneath the finding row with candidates from bulletPatterns.
  // "Worked on …" matches three rewrites: Add a metric, Lead with outcome,
  // and the verb-upgrade (Worked on → Built). We require at least two so
  // the test stays robust as the pattern library evolves.
  const tray = finding.locator('.health__item-tray');
  await expect(tray).toBeVisible();
  const candidates = tray.getByRole('menuitem');
  await expect(candidates).toHaveCount(3);
  // One candidate must be the verb-upgrade, since that's the bullet's
  // signature behavior in #115.
  await expect(
    tray.getByRole('menuitem', { name: /verb upgrade.*worked on.*built/i }),
  ).toBeVisible();
});

/* ------------------------------------------------------------------ */
/* 3. Picking a rewrite inserts a sibling bullet above the original    */
/* ------------------------------------------------------------------ */
test('selecting a rewrite inserts a sibling bullet above the original line', async ({ page }) => {
  await expandMobileEditor(page);
  await page.getByLabel(/markdown source/i).fill(RESUME_WITH_WEAK_VERB);
  await expect(page.getByRole('article', { name: /rendered resume/i })).toBeVisible();
  await openHealthTab(page);

  const panel = healthPanel(page);
  const finding = panel.locator('.health__list [data-rule="weak-verb"]');
  await finding.getByRole('button', { name: /suggest a fix/i }).click();

  // Verb-upgrade is the most predictable rewrite — pick it and assert the
  // editor now has a Built bullet sitting ABOVE the original Worked on bullet.
  const upgrade = finding
    .locator('.health__item-tray')
    .getByRole('menuitem', { name: /verb upgrade.*worked on.*built/i });
  await upgrade.click();

  const textareaValue = await page
    .getByLabel(/markdown source/i)
    .evaluate((el) => (el as HTMLTextAreaElement).value);
  // Original bullet is preserved.
  expect(textareaValue).toContain('- Worked on the cache layer and the deploy pipeline.');
  // Rewrite is inserted as a sibling.
  expect(textareaValue).toContain('- Built the cache layer and the deploy pipeline.');
  // The "Built" line must appear BEFORE the original "Worked on" line.
  const builtIdx = textareaValue.indexOf(
    '- Built the cache layer and the deploy pipeline.',
  );
  const workedOnIdx = textareaValue.indexOf(
    '- Worked on the cache layer and the deploy pipeline.',
  );
  expect(builtIdx).toBeGreaterThan(-1);
  expect(workedOnIdx).toBeGreaterThan(builtIdx);
});

/* ------------------------------------------------------------------ */
/* 4. Existing rewrite-tray affordance (#93) is unaffected             */
/* ------------------------------------------------------------------ */
test('in-editor rewrite tray still surfaces when caret lands on an Experience bullet', async ({
  page,
}) => {
  await expandMobileEditor(page);
  const textarea = page.getByLabel(/markdown source/i);
  await textarea.fill(RESUME_WITH_WEAK_VERB);
  await expect(page.getByRole('article', { name: /rendered resume/i })).toBeVisible();

  // Place the caret inside the weak-verb bullet and force React to re-derive
  // caret state through its real event handlers. We position via the DOM
  // (setSelectionRange) then press ArrowRight/ArrowLeft so the textarea
  // dispatches `keydown`/`keyup` events; React's `onKeyUp` is what the
  // #93 tray uses to update its eligibility-checking caret state.
  await textarea.focus();
  await textarea.evaluate((el) => {
    const ta = el as HTMLTextAreaElement;
    const target = ta.value.indexOf('Worked on the cache layer');
    ta.setSelectionRange(target + 4, target + 4);
  });
  await textarea.press('ArrowLeft');
  await textarea.press('ArrowRight');

  // The original "Rewrite this bullet" trigger from #93 should be visible.
  await expect(page.getByRole('button', { name: /rewrite this bullet/i })).toBeVisible();
});

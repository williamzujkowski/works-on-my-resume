/**
 * templates.spec.ts — "Start from template" flow (#86).
 *
 * Three concerns, three test groups:
 *
 *   1. Modal open/close — depends on integration. The TemplatePicker
 *      component lives in `src/components/TemplatePicker.tsx`, but the
 *      trigger (the "Start from template" affordance in MarkdownUploader)
 *      is wired in by a separate integration agent. These tests are
 *      `fixme`'d for that agent to flip on.
 *
 *   2. Selection fires onSelect and loads the template — same gating.
 *
 *   3. Template content sanity — runs today. Fetches each
 *      `public/templates/*.md` directly via `page.goto()` and asserts the
 *      file is reachable and carries the expected frontmatter keys. This
 *      protects the templates themselves from accidental deletion or
 *      malformed frontmatter regardless of any UI wiring.
 */
import { test, expect } from '@playwright/test';
import { clearAppStorage } from './helpers';

/** The four template slugs, kept in lockstep with TemplatePicker.tsx. */
const TEMPLATE_SLUGS = ['junior', 'mid', 'senior', 'em'] as const;
type TemplateSlug = (typeof TEMPLATE_SLUGS)[number];

/* ------------------------------------------------------------------ */
/* Group 1 — modal open/close. Gated on integration. ------------------ */
/* ------------------------------------------------------------------ */

test.describe('Start from template — modal lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppStorage(page);
    await page.goto('');
  });

  test('opens the template picker dialog and closes it on Escape, restoring focus to the trigger', async ({
    page,
  }) => {
    // TODO(integration): the trigger button is wired into MarkdownUploader
    // by the integration agent. Update the accessible name below to match
    // whatever the agent settles on (likely "Start from template").
    const trigger = page.getByRole('button', { name: /start from (a )?template/i });
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: /start from a template/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: /close template picker/i })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('Close button dismisses the dialog', async ({ page }) => {
    // TODO(integration): same trigger wiring as above.
    await page.getByRole('button', { name: /start from (a )?template/i }).click();
    const dialog = page.getByRole('dialog', { name: /start from a template/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /close template picker/i }).click();
    await expect(dialog).toHaveCount(0);
  });
});

/* ------------------------------------------------------------------ */
/* Group 2 — selecting a card loads the template. Gated on integration. */
/* ------------------------------------------------------------------ */

test.describe('Start from template — selection loads the resume', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppStorage(page);
    await page.goto('');
  });

  /* Expected identity heading per template — taken from the frontmatter
     `name` field. The renderer surfaces this as the largest line of the
     identity header at the top of the rendered article. */
  const EXPECTED_NAME: Record<TemplateSlug, string> = {
    junior: 'Riley Okonkwo',
    mid: 'Priya Salgado',
    senior: 'Marcus Halberg',
    em: 'Dani Velasquez',
  };

  for (const slug of TEMPLATE_SLUGS) {
    test(`selecting "${slug}" loads its resume into the preview`, async ({ page }) => {
      // TODO(integration): the integration agent wires the trigger and the
      // card buttons through MarkdownUploader. This test asserts the
      // contract: clicking a card MUST cause that template's frontmatter
      // name to appear inside the rendered article.
      await page.getByRole('button', { name: /start from (a )?template/i }).click();

      const dialog = page.getByRole('dialog', { name: /start from a template/i });
      await expect(dialog).toBeVisible();

      // Each card carries a "Use this template" button; pick the one whose
      // nearest heading matches the slug's human label.
      const cardLabels: Record<TemplateSlug, RegExp> = {
        junior: /junior ic/i,
        mid: /mid ic/i,
        senior: /senior ic/i,
        em: /engineering manager/i,
      };
      const card = dialog
        .locator('li', { has: page.getByRole('heading', { name: cardLabels[slug] }) })
        .first();
      await card.getByRole('button', { name: /use this template/i }).click();

      const article = page.getByRole('article', { name: /rendered resume/i });
      await expect(article).toBeVisible({ timeout: 10_000 });
      await expect(article.getByText(EXPECTED_NAME[slug])).toBeVisible();
    });
  }
});

/* ------------------------------------------------------------------ */
/* Group 3 — template content sanity. Runs today. -------------------- */
/* ------------------------------------------------------------------ */

test.describe('Template files are reachable and well-formed', () => {
  /* Minimum frontmatter the renderer reads (and the writing guide
     documents). If a future edit ever drops one of these we want a
     loud, named failure rather than a silent broken card. */
  const REQUIRED_FRONTMATTER_KEYS = ['name', 'role', 'email'] as const;

  for (const slug of TEMPLATE_SLUGS) {
    test(`templates/${slug}.md is served and carries the required frontmatter keys`, async ({
      page,
    }) => {
      // `page.goto` resolves against the Playwright baseURL, which already
      // includes the configured Astro base path. Fetching the asset as a
      // navigation gives us a real HTTP status and the raw text in one step.
      const response = await page.goto(`templates/${slug}.md`);
      expect(response, `templates/${slug}.md should respond`).not.toBeNull();
      expect(response!.status(), `templates/${slug}.md HTTP status`).toBe(200);

      const body = await response!.text();

      // Frontmatter must be at the very top, fenced by --- lines.
      expect(body.startsWith('---\n'), `${slug}.md must start with frontmatter`).toBe(true);
      const frontmatterEnd = body.indexOf('\n---', 4);
      expect(frontmatterEnd, `${slug}.md must have a closing --- fence`).toBeGreaterThan(0);
      const frontmatter = body.slice(4, frontmatterEnd);

      for (const key of REQUIRED_FRONTMATTER_KEYS) {
        expect(
          new RegExp(`(^|\\n)${key}:`).test(frontmatter),
          `${slug}.md frontmatter must declare ${key}:`,
        ).toBe(true);
      }

      // Body should have at least one `##` section heading — the conventional
      // structure documented in docs/writing-your-resume.md.
      const bodyAfterFrontmatter = body.slice(frontmatterEnd + 4);
      expect(
        /\n## /.test(bodyAfterFrontmatter),
        `${slug}.md body must use ## section headings`,
      ).toBe(true);
    });
  }
});

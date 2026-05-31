import { test, expect, type Locator, type Page } from '@playwright/test';
import { clearAppStorage } from './helpers';

async function expectNoPageOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    root: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));

  expect(metrics.root).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.body).toBeLessThanOrEqual(metrics.viewport + 1);
}

async function expectInsideViewport(locator: Locator, page: Page): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 1);
}

test.beforeEach(async ({ page }) => {
  await clearAppStorage(page);
  await page.goto('');
});

test('#206 mobile gist import controls stay within a 360px viewport', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'mobile-iphone-13',
    'the overflow regression is specific to narrow mobile viewports',
  );

  await page.setViewportSize({ width: 360, height: 740 });
  await page.route('https://api.github.com/gists/abcde', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        files: {
          'resume.md': {
            filename: 'resume.md',
            language: 'Markdown',
            content: '---\nname: Avery Quinn\n---\n\n## Summary\nA short resume.',
          },
          'very-long-companion-file-name-that-used-to-stretch-mobile.md': {
            filename: 'very-long-companion-file-name-that-used-to-stretch-mobile.md',
            language: 'Markdown',
            content: '# Companion file',
          },
        },
      }),
    });
  });

  await page.getByText('Import from a public GitHub Gist').click();

  const input = page.getByLabel('Gist URL');
  await expect(input).toBeVisible();
  await expectInsideViewport(input, page);
  await expectNoPageOverflow(page);

  await input.fill('https://gist.github.com/you/abcde');
  await page.getByRole('button', { name: /^import$/i }).click();

  const picker = page.locator('.uploader__gist-preview-picker-select');
  await expect(picker).toBeVisible();
  await expectInsideViewport(picker, page);
  await expectNoPageOverflow(page);
});

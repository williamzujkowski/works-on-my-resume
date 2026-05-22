/**
 * Export & download utilities for Works on My Resume.
 *
 * Everything in this module happens locally, in the browser. Nothing is
 * uploaded, stored on a server, or transmitted anywhere: each export builds
 * a string in memory, wraps it in a Blob, and hands it to the browser's
 * download mechanism via an object URL. There is no network involvement.
 *
 * The module is import-safe during SSR / static build: it never touches
 * `document` or `window` at module scope, and every browser-only function
 * guards those globals before use.
 */

import type { ResumeTheme, ResumeFrontmatter } from '../types';
import { themeCssVariables } from './themes';

/*
 * Single source of truth for resume-document styling.
 *
 * `resume.css` styles the in-app preview (it is `@import`ed by global.css).
 * The standalone-HTML export needs the SAME styling, so rather than keeping
 * a hand-maintained copy here — which inevitably drifts — we import the
 * exact same stylesheet as a raw string via Vite's `?raw` suffix and inline
 * it into the exported document.
 *
 * `resume.css` is written to be self-contained for exactly this use: it is
 * fully scoped under `.resume-preview`, carries its own `--resume-*` color
 * fallbacks, its own type tokens, and a `box-sizing` reset, so it renders
 * correctly embedded in a bare exported `<body>` with no other CSS.
 *
 * The only resume styling NOT in `resume.css` is `STANDALONE_EXPORT_CSS`
 * below: the bare-document framing (page background, centering) and a print
 * block that the export needs but the in-app build gets from `print.css`.
 */
import resumeCss from '../styles/resume.css?raw';

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

/** True only in a real browser environment (not during SSR / build). */
function isBrowser(): boolean {
  return typeof document !== 'undefined' && typeof window !== 'undefined';
}

/**
 * Slugify a candidate string for use in a filename: lowercase, with every
 * run of non-alphanumeric characters collapsed to a single hyphen and any
 * leading/trailing hyphens trimmed. Falls back to `resume` when the input
 * is empty or yields nothing usable.
 */
function slugify(input: string | undefined): string {
  if (!input) return 'resume';
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'resume';
}

/**
 * Minimal HTML-escape for text interpolated into markup (e.g. the document
 * title derived from frontmatter). Keeps the standalone export XSS-safe even
 * though the resume body itself is already sanitized upstream.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Trigger a client-side download of `content` as `filename`.
 *
 * Wraps the content in a Blob, mints a temporary object URL, clicks a
 * detached `<a download>`, then cleans up both the element and the URL.
 * No-ops during SSR / build so callers need not guard themselves.
 */
function triggerDownload(content: string, filename: string, mimeType: string): void {
  if (!isBrowser()) return;

  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    // Detached anchors are not part of the layout; appending is only needed
    // for broad cross-browser compatibility of the synthetic click.
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    // Always release the object URL so the Blob can be garbage-collected.
    URL.revokeObjectURL(url);
  }
}

/* ------------------------------------------------------------------ */
/* Export-only stylesheet supplement                                   */
/* ------------------------------------------------------------------ */

/**
 * The SMALL slice of styling that the standalone export needs but the
 * in-app build gets from elsewhere.
 *
 * The bulk of the resume styling is `resumeCss` (the shared `resume.css`).
 * That file styles the `.resume-preview` document but deliberately says
 * nothing about the page it sits on — in the app that framing comes from
 * `global.css` / `.preview-frame`, and print handling comes from `print.css`.
 *
 * An exported document has neither, so this supplement provides exactly two
 * things and nothing more:
 *   - bare-document framing: a reset, a page background, and centering the
 *     `.resume-preview` sheet on the page;
 *   - a print block, so the downloaded HTML prints cleanly (drop the page
 *     chrome, avoid awkward page breaks, keep links readable).
 */
const STANDALONE_EXPORT_CSS = `
/* Bare-document framing — the page the resume sheet rests on. */
*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 2.5rem 1rem;
  background: var(--resume-bg, #ffffff);
  color: var(--resume-fg, #1f2328);
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}

/* Center the resume sheet; resume.css owns the sheet's own appearance. */
.resume-preview {
  margin-inline: auto;
}

/* Print: drop the page padding and the sheet chrome, keep breaks clean. */
@media print {
  body {
    padding: 0;
    background: #ffffff;
  }

  .resume-preview {
    max-width: none;
    margin: 0;
    padding: 0;
    background: #ffffff;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .resume-preview a {
    color: inherit;
  }

  .resume-preview h1,
  .resume-preview h2,
  .resume-preview h3,
  .resume-preview h4 {
    page-break-after: avoid;
    break-after: avoid;
  }

  .resume-preview li,
  .resume-preview p,
  .resume-preview blockquote,
  .resume-preview pre,
  .resume-preview table,
  .resume-preview img {
    page-break-inside: avoid;
    break-inside: avoid;
  }
}
`.trim();

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Build a complete, dependency-free standalone HTML document for a resume.
 *
 * The returned string is a valid `<!doctype html>` document with everything
 * inlined in a single `<style>` block, in cascade order:
 *   1. the theme's `--resume-*` custom properties (`themeCssVariables`);
 *   2. `resumeCss` — the shared `resume.css`, the SAME stylesheet that
 *      styles the in-app preview, so the export can never drift from it;
 *   3. `STANDALONE_EXPORT_CSS` — bare-document framing + print rules.
 * There are no external CSS files, scripts, fonts, or network requests, so
 * the file renders the same offline, on any machine.
 *
 * @param resumeHtml  Already-sanitized resume HTML (output of the Markdown
 *                    pipeline). It is embedded verbatim and is NOT escaped.
 * @param theme       The active theme; its CSS variables are inlined.
 * @param frontmatter Resume frontmatter; `name` seeds the document title.
 */
export function buildStandaloneHtml(
  resumeHtml: string,
  theme: ResumeTheme,
  frontmatter: ResumeFrontmatter,
): string {
  const name = frontmatter.name?.trim();
  const title = name ? `${name} — Resume` : 'Resume';
  const themeVars = themeCssVariables(theme);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="generator" content="Works on My Resume" />
    <style>
${themeVars}

${resumeCss}

${STANDALONE_EXPORT_CSS}
    </style>
  </head>
  <body>
    <!-- Generated by Works on My Resume. Resume content was processed locally in the browser. -->
    <article class="resume-preview">
${resumeHtml}
    </article>
  </body>
</html>
`;
}

/**
 * Download the raw Markdown source of the resume as a `.md` file.
 *
 * The filename is derived from `frontmatter.name` (slugified), e.g.
 * `avery-quinn-resume.md`, defaulting to `resume.md` when no name is set.
 * No-ops outside the browser.
 */
export function downloadMarkdown(markdown: string, frontmatter: ResumeFrontmatter): void {
  const filename = `${slugify(frontmatter.name)}-resume.md`;
  triggerDownload(markdown, filename, 'text/markdown');
}

/**
 * Download the rendered resume as a standalone, self-contained `.html` file.
 *
 * The file embeds the active theme and a print-friendly stylesheet, so it can
 * be opened, shared, or printed anywhere with no dependencies. The filename
 * is derived from `frontmatter.name` (slugified), e.g. `avery-quinn-resume.html`.
 * No-ops outside the browser.
 */
export function downloadResumeHtml(
  resumeHtml: string,
  theme: ResumeTheme,
  frontmatter: ResumeFrontmatter,
): void {
  const html = buildStandaloneHtml(resumeHtml, theme, frontmatter);
  const filename = `${slugify(frontmatter.name)}-resume.html`;
  triggerDownload(html, filename, 'text/html');
}

/**
 * Download just the active theme as a `.css` file containing the
 * `:root { --resume-*: ...; }` custom-property block.
 *
 * Useful for reusing a theme in another document. The filename is
 * `theme-<theme.slug>.css`. No-ops outside the browser.
 */
export function downloadThemeCss(theme: ResumeTheme): void {
  const css = themeCssVariables(theme);
  const filename = `theme-${slugify(theme.slug)}.css`;
  triggerDownload(css, filename, 'text/css');
}

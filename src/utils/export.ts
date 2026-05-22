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
/* Standalone resume stylesheet                                        */
/* ------------------------------------------------------------------ */

/**
 * Self-contained, print-friendly stylesheet for the exported resume.
 *
 * It consumes ONLY the semantic `--resume-*` custom properties for color, so
 * the same markup renders correctly under any theme. There are no external
 * fonts, no imports, and no network requests — only system font stacks.
 */
const STANDALONE_RESUME_CSS = `
*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  /* Sensible fallbacks so the document is readable even without theme vars. */
  --resume-bg: #ffffff;
  --resume-fg: #1a1a1a;
  --resume-muted: #555555;
  --resume-accent: #0b5fff;
  --resume-accent-2: #6b3df5;
  --resume-border: #d8d8d8;
  --resume-card: #f5f5f5;
  --resume-code-bg: #f0f0f0;
}

body {
  margin: 0;
  padding: 2.5rem 1rem;
  background: var(--resume-bg);
  color: var(--resume-fg);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica,
    Arial, sans-serif;
  font-size: 16px;
  line-height: 1.55;
  -webkit-text-size-adjust: 100%;
}

.resume-preview {
  max-width: 50rem;
  margin: 0 auto;
  padding: 2.5rem;
  background: var(--resume-card);
  border: 1px solid var(--resume-border);
  border-radius: 8px;
}

.resume-preview h1,
.resume-preview h2,
.resume-preview h3,
.resume-preview h4,
.resume-preview h5,
.resume-preview h6 {
  margin: 1.6em 0 0.5em;
  line-height: 1.25;
  font-weight: 700;
}

.resume-preview h1 {
  margin-top: 0;
  font-size: 2rem;
  color: var(--resume-accent);
}

.resume-preview h2 {
  font-size: 1.35rem;
  padding-bottom: 0.25em;
  border-bottom: 2px solid var(--resume-border);
}

.resume-preview h3 {
  font-size: 1.1rem;
  color: var(--resume-accent-2);
}

.resume-preview p,
.resume-preview ul,
.resume-preview ol,
.resume-preview blockquote,
.resume-preview table {
  margin: 0 0 0.85em;
}

.resume-preview ul,
.resume-preview ol {
  padding-left: 1.4em;
}

.resume-preview li {
  margin: 0.2em 0;
}

.resume-preview a {
  color: var(--resume-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.resume-preview strong {
  font-weight: 700;
}

.resume-preview em {
  font-style: italic;
}

.resume-preview small,
.resume-preview .muted {
  color: var(--resume-muted);
}

.resume-preview hr {
  height: 1px;
  margin: 1.6em 0;
  border: 0;
  background: var(--resume-border);
}

.resume-preview blockquote {
  margin-left: 0;
  padding: 0.4em 1em;
  border-left: 3px solid var(--resume-accent);
  color: var(--resume-muted);
}

.resume-preview code {
  padding: 0.15em 0.4em;
  background: var(--resume-code-bg);
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas,
    'Liberation Mono', monospace;
  font-size: 0.9em;
}

.resume-preview pre {
  margin: 0 0 0.85em;
  padding: 0.9em 1em;
  background: var(--resume-code-bg);
  border: 1px solid var(--resume-border);
  border-radius: 6px;
  overflow-x: auto;
}

.resume-preview pre code {
  padding: 0;
  background: none;
}

.resume-preview table {
  width: 100%;
  border-collapse: collapse;
}

.resume-preview th,
.resume-preview td {
  padding: 0.4em 0.6em;
  border: 1px solid var(--resume-border);
  text-align: left;
}

.resume-preview th {
  background: var(--resume-code-bg);
}

.resume-preview img {
  max-width: 100%;
  height: auto;
}

/* Print: drop the page chrome, keep the text crisp and ink-friendly. */
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
  }

  .resume-preview a {
    color: inherit;
  }

  .resume-preview h2,
  .resume-preview h3,
  .resume-preview h1 {
    page-break-after: avoid;
  }

  .resume-preview li,
  .resume-preview p,
  .resume-preview blockquote,
  .resume-preview pre {
    page-break-inside: avoid;
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
 * inlined: the theme's `--resume-*` custom properties and a print-friendly
 * resume stylesheet live in a single `<style>` block. There are no external
 * CSS files, scripts, fonts, or network requests, so the file renders the
 * same offline, on any machine.
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

${STANDALONE_RESUME_CSS}
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

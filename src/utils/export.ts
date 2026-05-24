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
 *
 * Print-mode contract (#82). The standalone HTML export mirrors the in-app
 * print modes so a downloaded file behaves the same way the studio does when
 * the recipient prints it.
 *   - The export ALWAYS embeds the active theme's `--resume-*` variables so
 *     the document renders themed when opened normally in a browser.
 *   - The `<body>` carries `data-print-mode="<mode>"` and the embedded print
 *     block branches on that attribute, exactly like `src/styles/print.css`
 *     branches on `body[data-print-mode]` in the live app.
 *   - The default is `'conservative'`: a downloaded file should print
 *     black-on-white by default — the same safer default the in-app panel
 *     ships with, and the one that respects the user's ink and ATS parsers.
 *     Callers who want themed print explicitly pass `'theme'`.
 */

import type { PrintMode, ResumeTheme, ResumeFrontmatter, ResumeTemplate } from '../types';
import { DEFAULT_RESUME_TEMPLATE } from '../types';
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
 *
 * The print block branches on `body[data-print-mode]`, mirroring the live
 * app's `src/styles/print.css`:
 *   - `theme`: keep the embedded theme's colors in print, and tell the
 *     browser to actually paint them (`print-color-adjust: exact`).
 *   - any other value (`conservative` or missing): force black-on-white ink,
 *     readable underlined links, and neutralize the `modern` layout's
 *     decorative mono uppercase headings so an exported file prints the same
 *     ATS-plain output the studio's conservative mode produces.
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
  }

  .resume-preview {
    max-width: none;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    box-shadow: none;
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

  /* ----------------------------------------------------------------
   * THEME mode — print with the embedded theme's colors. The browser
   * has to be told to actually paint background colors in print.
   * -------------------------------------------------------------- */
  body[data-print-mode='theme'] {
    background: var(--resume-bg, #ffffff);
  }

  body[data-print-mode='theme'] .resume-preview {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ----------------------------------------------------------------
   * CONSERVATIVE mode (also covers a missing attribute). Black ink on
   * white paper, underlined links, no decorative color. Mirrors the
   * conservative branch of src/styles/print.css.
   * -------------------------------------------------------------- */
  body:not([data-print-mode='theme']) {
    background: #ffffff;
  }

  body:not([data-print-mode='theme']) .resume-preview {
    background: #ffffff !important;
    color: #000 !important;
  }

  body:not([data-print-mode='theme']) .resume-preview :is(h1, h2, h3, h4),
  body:not([data-print-mode='theme']) .resume-preview strong,
  body:not([data-print-mode='theme']) .resume-preview li::marker,
  body:not([data-print-mode='theme']) .resume-preview th {
    color: #000 !important;
    background: none !important;
  }

  body:not([data-print-mode='theme']) .resume-preview h2 {
    border-bottom-color: #000 !important;
  }

  body:not([data-print-mode='theme']) .resume-preview a {
    color: #000 !important;
    text-decoration: underline;
  }

  body:not([data-print-mode='theme']) .resume-preview :is(blockquote, hr) {
    background: none !important;
    border-color: #000 !important;
    color: #222 !important;
  }

  body:not([data-print-mode='theme']) .resume-preview :is(code, pre, table, th, td) {
    background: #fff !important;
    border-color: #000 !important;
  }

  body:not([data-print-mode='theme']) .resume-preview__contact-name {
    color: #000 !important;
  }

  body:not([data-print-mode='theme']) .resume-preview__contact-role {
    color: #222 !important;
  }

  body:not([data-print-mode='theme'])
    .resume-preview
    :is(.resume-preview__contact, .resume-preview__contact-meta) {
    color: #222 !important;
    border-color: #000 !important;
  }

  body:not([data-print-mode='theme']) .resume-preview__contact-meta a {
    color: #000 !important;
  }

  /* Conservative × modern layout: neutralize the mono uppercase overlay
     so a downloaded modern-layout resume prints ATS-plain serif.
     Mirrors the same #81 block in src/styles/print.css. */
  body:not([data-print-mode='theme']) .resume-preview[data-template='modern'] :is(h1, h2, h3, h4) {
    font-family: 'Source Serif 4', Charter, 'Iowan Old Style', Georgia, serif !important;
    text-transform: none !important;
    letter-spacing: 0 !important;
    color: #000 !important;
  }

  body:not([data-print-mode='theme']) .resume-preview[data-template='modern'] h2 {
    border-bottom-color: #000 !important;
  }

  body:not([data-print-mode='theme'])
    .resume-preview[data-template='modern']
    :is(h3 + p em, h4 + p em) {
    font-family: 'Source Serif 4', Charter, 'Iowan Old Style', Georgia, serif !important;
    text-transform: none !important;
    letter-spacing: 0 !important;
    color: #222 !important;
  }

  body:not([data-print-mode='theme'])
    .resume-preview[data-template='modern']
    .resume-preview__contact {
    border-bottom-color: #000 !important;
  }

  body:not([data-print-mode='theme'])
    .resume-preview[data-template='modern']
    .resume-preview__contact-name {
    letter-spacing: 0 !important;
    color: #000 !important;
  }

  body:not([data-print-mode='theme'])
    .resume-preview[data-template='modern']
    .resume-preview__contact-role {
    font-family: 'Source Serif 4', Charter, 'Iowan Old Style', Georgia, serif !important;
    text-transform: none !important;
    letter-spacing: 0 !important;
    color: #222 !important;
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
 *   3. `STANDALONE_EXPORT_CSS` — bare-document framing + print rules that
 *      branch on `body[data-print-mode]` (see file header for the contract).
 * There are no external CSS files, scripts, fonts, or network requests, so
 * the file renders the same offline, on any machine.
 *
 * @param resumeHtml  Already-sanitized resume HTML (output of the Markdown
 *                    pipeline). It is embedded verbatim and is NOT escaped.
 * @param theme       The active theme; its CSS variables are inlined so the
 *                    document still renders themed when opened in a browser,
 *                    regardless of which print mode the recipient ends up
 *                    using.
 * @param frontmatter Resume frontmatter; `name` seeds the document title.
 * @param template    The active layout template (#30). Applied as
 *                    `data-template="<slug>"` on the `.resume-preview`
 *                    element so the CSS variant is preserved in the export.
 *                    Defaults to `classic`.
 * @param mode        Print mode the embedded `@media print` block resolves
 *                    against (#82). `'conservative'` (the default — the
 *                    safer choice for a downloaded file) prints
 *                    black-on-white ATS-plain; `'theme'` prints with the
 *                    embedded theme's colors.
 */
export function buildStandaloneHtml(
  resumeHtml: string,
  theme: ResumeTheme,
  frontmatter: ResumeFrontmatter,
  template: ResumeTemplate = DEFAULT_RESUME_TEMPLATE,
  mode: PrintMode = 'conservative',
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
  <body data-print-mode="${escapeHtml(mode)}">
    <!-- Generated by Works on My Resume. Resume content was processed locally in the browser. -->
    <article class="resume-preview" data-template="${escapeHtml(template)}">
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
 * The file embeds the active theme, the active layout template (#30), and a
 * print-friendly stylesheet that branches on the chosen `mode` (#82), so it
 * can be opened, shared, or printed anywhere with no dependencies. The
 * filename is derived from `frontmatter.name` (slugified), e.g.
 * `avery-quinn-resume.html`. No-ops outside the browser.
 */
export function downloadResumeHtml(
  resumeHtml: string,
  theme: ResumeTheme,
  frontmatter: ResumeFrontmatter,
  template: ResumeTemplate = DEFAULT_RESUME_TEMPLATE,
  mode: PrintMode = 'conservative',
): void {
  const html = buildStandaloneHtml(resumeHtml, theme, frontmatter, template, mode);
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

/* ------------------------------------------------------------------ */
/* Store-only ZIP writer (#35)                                         */
/* ------------------------------------------------------------------ */

/*
 * Hand-rolled, dependency-free ZIP builder.
 *
 * We need to bundle `resume.md`, `resume.html`, and `theme-<slug>.css` into a
 * single download without pulling in JSZip or fflate. The ZIP container is
 * compact and stable enough to write directly: a per-entry local file header
 * followed by the file's uncompressed bytes, then a central directory and an
 * end-of-central-directory record. We use the STORE method (compression
 * type 0 — no DEFLATE), so the bytes are written verbatim and the format
 * stays minimal. The output opens cleanly in Finder, Windows Explorer,
 * macOS Archive Utility, and `unzip` on Linux.
 *
 * Reference: APPNOTE.TXT 6.3.10 (PKWARE ZIP specification).
 */

/** One entry in the ZIP, normalized to bytes with a stable filename. */
interface ZipEntry {
  /** UTF-8 encoded filename inside the archive (forward slashes only). */
  name: string;
  /** Raw file bytes. */
  data: Uint8Array;
  /** CRC-32 of `data`, computed once and reused for both header records. */
  crc32: number;
  /** Local-header offset within the assembled archive, set during writing. */
  offset: number;
}

/**
 * Precomputed CRC-32 lookup table.
 *
 * Built lazily on first use so we never pay the 256-iteration cost when no
 * one calls the ZIP path. The polynomial (0xEDB88320, the reversed form of
 * 0x04C11DB7) is the standard one used by every ZIP implementation.
 */
let crc32Table: Uint32Array | null = null;
function getCrc32Table(): Uint32Array {
  if (crc32Table) return crc32Table;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  crc32Table = table;
  return table;
}

/** Compute the standard CRC-32 of a byte buffer. */
function crc32(bytes: Uint8Array): number {
  const table = getCrc32Table();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = (c >>> 8) ^ table[(c ^ bytes[i]) & 0xff];
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Encode a string into UTF-8 bytes.
 *
 * `TextEncoder` is universally available in every browser this app targets
 * (and in Node). We never call this at module scope, only from helpers that
 * are themselves browser-only, so SSR is unaffected.
 */
function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/**
 * Encode a JS `Date` into the legacy MS-DOS date/time fields that ZIP uses.
 *
 * Two `uint16` values. Time resolution is 2 seconds (the low bit of seconds
 * is dropped); the year is offset from 1980 (ZIP epoch). Values clamp to
 * 1980 for any pre-epoch date so the archive is always parseable.
 */
function dosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear());
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  return { dosTime: dosTime & 0xffff, dosDate: dosDate & 0xffff };
}

/** Write a little-endian uint16 into `view` at `offset`. */
function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, true);
}

/** Write a little-endian uint32 into `view` at `offset`. */
function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

/** Copy `bytes` into `target` starting at `offset`. */
function writeBytes(target: Uint8Array, offset: number, bytes: Uint8Array): void {
  target.set(bytes, offset);
}

/* ZIP "magic numbers" — fixed signatures from APPNOTE.TXT 6.3.10. */
const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIRECTORY_SIG = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIG = 0x06054b50;

/* Header fixed sizes (excluding the variable-length filename). */
const LOCAL_FILE_HEADER_FIXED = 30;
const CENTRAL_DIRECTORY_FIXED = 46;
const END_OF_CENTRAL_DIRECTORY = 22;

/**
 * Build a store-only (no DEFLATE) ZIP from an ordered list of files.
 *
 * Returns a Uint8Array containing the full archive bytes. The layout is the
 * minimal three-section ZIP container:
 *
 *   [local file header + filename + bytes] * N
 *   [central directory entry + filename] * N
 *   [end-of-central-directory record]
 *
 * Each file is stored uncompressed (compression method 0), so the resulting
 * archive is slightly larger than a DEFLATE one but trivial to produce
 * without any compression library. The format is the same ZIP variant macOS
 * Archive Utility writes for "Compress" with already-compressed inputs.
 */
function buildStoreOnlyZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const now = new Date();
  const { dosTime, dosDate } = dosDateTime(now);

  // Pre-encode each entry: filename bytes, CRC, size. We compute every byte
  // needed for both the local headers and the central directory now, so the
  // final write pass is straight memcpy + integer writes.
  const entries: (ZipEntry & { nameBytes: Uint8Array })[] = files.map((file) => {
    const nameBytes = encodeUtf8(file.name);
    return {
      name: file.name,
      nameBytes,
      data: file.data,
      crc32: crc32(file.data),
      offset: 0,
    };
  });

  // First pass: compute the offset of each local header, then the offset and
  // size of the central directory.
  let localSize = 0;
  for (const entry of entries) {
    entry.offset = localSize;
    localSize += LOCAL_FILE_HEADER_FIXED + entry.nameBytes.length + entry.data.length;
  }
  const centralSize = entries.reduce(
    (sum, entry) => sum + CENTRAL_DIRECTORY_FIXED + entry.nameBytes.length,
    0,
  );
  const totalSize = localSize + centralSize + END_OF_CENTRAL_DIRECTORY;

  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);

  // ----- Local file headers + file bytes ------------------------------
  for (const entry of entries) {
    const o = entry.offset;
    writeU32(view, o + 0, LOCAL_FILE_HEADER_SIG);
    writeU16(view, o + 4, 20); // version needed to extract (2.0 = STORE/DEFLATE base)
    writeU16(view, o + 6, 0x0800); // general purpose bit flag: bit 11 = UTF-8 filename
    writeU16(view, o + 8, 0); // compression method: 0 = STORE
    writeU16(view, o + 10, dosTime);
    writeU16(view, o + 12, dosDate);
    writeU32(view, o + 14, entry.crc32);
    writeU32(view, o + 18, entry.data.length); // compressed size (== uncompressed for STORE)
    writeU32(view, o + 22, entry.data.length); // uncompressed size
    writeU16(view, o + 26, entry.nameBytes.length);
    writeU16(view, o + 28, 0); // extra field length

    writeBytes(buffer, o + LOCAL_FILE_HEADER_FIXED, entry.nameBytes);
    writeBytes(buffer, o + LOCAL_FILE_HEADER_FIXED + entry.nameBytes.length, entry.data);
  }

  // ----- Central directory entries ------------------------------------
  let centralOffset = localSize;
  for (const entry of entries) {
    const o = centralOffset;
    writeU32(view, o + 0, CENTRAL_DIRECTORY_SIG);
    writeU16(view, o + 4, 0x033f); // version made by: 0x033f = UNIX, ZIP 6.3
    writeU16(view, o + 6, 20); // version needed to extract
    writeU16(view, o + 8, 0x0800); // general purpose bit flag (UTF-8 names)
    writeU16(view, o + 10, 0); // compression method: STORE
    writeU16(view, o + 12, dosTime);
    writeU16(view, o + 14, dosDate);
    writeU32(view, o + 16, entry.crc32);
    writeU32(view, o + 20, entry.data.length); // compressed size
    writeU32(view, o + 24, entry.data.length); // uncompressed size
    writeU16(view, o + 28, entry.nameBytes.length);
    writeU16(view, o + 30, 0); // extra field length
    writeU16(view, o + 32, 0); // file comment length
    writeU16(view, o + 34, 0); // disk number start
    writeU16(view, o + 36, 0); // internal file attributes
    writeU32(view, o + 38, 0); // external file attributes
    writeU32(view, o + 42, entry.offset); // relative offset of local header

    writeBytes(buffer, o + CENTRAL_DIRECTORY_FIXED, entry.nameBytes);

    centralOffset += CENTRAL_DIRECTORY_FIXED + entry.nameBytes.length;
  }

  // ----- End of central directory record ------------------------------
  const eo = localSize + centralSize;
  writeU32(view, eo + 0, END_OF_CENTRAL_DIRECTORY_SIG);
  writeU16(view, eo + 4, 0); // number of this disk
  writeU16(view, eo + 6, 0); // disk where central directory starts
  writeU16(view, eo + 8, entries.length); // number of central dir records on this disk
  writeU16(view, eo + 10, entries.length); // total number of central dir records
  writeU32(view, eo + 12, centralSize); // size of central directory
  writeU32(view, eo + 16, localSize); // offset of central directory
  writeU16(view, eo + 20, 0); // ZIP file comment length

  return buffer;
}

/**
 * Trigger a client-side download of `bytes` as `filename`.
 *
 * Mirror of `triggerDownload` for already-binary content. Wrapping in a Blob
 * with `application/zip` lets every browser tag the download correctly.
 */
function triggerBinaryDownload(bytes: Uint8Array, filename: string, mimeType: string): void {
  if (!isBrowser()) return;

  // Copy into a fresh ArrayBuffer so the Blob owns its bytes; `bytes.buffer`
  // may be a SharedArrayBuffer or a view over a larger pool in some hosts.
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
  const url = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Download the resume as a ZIP archive bundling the Markdown source, the
 * standalone HTML render, and the active theme's CSS (#35).
 *
 * The archive contains three files at its root:
 *   - `resume.md`            — the raw Markdown source.
 *   - `resume.html`          — the standalone, self-contained HTML render
 *                              (built via `buildStandaloneHtml`, so it
 *                              already embeds the theme and template).
 *   - `theme-<slug>.css`     — the active theme as a reusable CSS file.
 *
 * Filename: `<slug-from-name>-resume.zip`, e.g. `avery-quinn-resume.zip`.
 * No-ops outside the browser.
 *
 * Notes:
 *  - The ZIP uses the STORE method (no compression), so it is a touch
 *    larger than a DEFLATEd one but needs no compression dependency.
 *  - Filenames use forward slashes (none here — flat archive) and are
 *    UTF-8 encoded; the general-purpose bit 11 is set so the filename
 *    encoding is unambiguous.
 */
export function downloadResumeZip(
  markdown: string,
  resumeHtml: string,
  theme: ResumeTheme,
  frontmatter: ResumeFrontmatter,
  template: ResumeTemplate = DEFAULT_RESUME_TEMPLATE,
  mode: PrintMode = 'conservative',
): void {
  if (!isBrowser()) return;

  const standaloneHtml = buildStandaloneHtml(resumeHtml, theme, frontmatter, template, mode);
  const themeCss = themeCssVariables(theme);
  const themeFilename = `theme-${slugify(theme.slug)}.css`;

  const files = [
    { name: 'resume.md', data: encodeUtf8(markdown) },
    { name: 'resume.html', data: encodeUtf8(standaloneHtml) },
    { name: themeFilename, data: encodeUtf8(themeCss) },
  ];

  const zipBytes = buildStoreOnlyZip(files);
  const filename = `${slugify(frontmatter.name)}-resume.zip`;
  triggerBinaryDownload(zipBytes, filename, 'application/zip');
}

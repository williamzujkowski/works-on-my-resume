# Works on My Resume

**Markdown in. Resume out. No servers harmed.**

A static, local-first Markdown resume renderer. Bring a Markdown resume,
preview it instantly, dress it in one of 545 OKLCH terminal themes, print it,
or export it — all in your browser. There is no backend, no account, and no
analytics. Your resume never leaves your machine.

## What it does

- **Bring your Markdown.** Upload a `.md` file or paste/type Markdown directly
  into the editor.
- **Preview instantly.** The rendered resume updates as you edit.
- **Cycle themes.** Browse 545 OKLCH terminal color themes, normalized into
  semantic resume tokens, and apply any of them with one click.
- **Print.** A print-friendly stylesheet produces clean, ink-aware output via
  your browser's native print dialog — no PDF service involved.
- **Export.** Download the raw Markdown, a fully self-contained standalone
  HTML file, or just the active theme as a `.css` file.

Everything above happens locally, in the page.

## Privacy

This is a fully static, local-first application.

- Resume content is parsed, sanitized, rendered, and exported **entirely in
  the browser**.
- The app does **not** upload, store, or transmit resume content — there is no
  server to send it to.
- Shareable theme links carry **only the selected theme** (its slug). They
  never contain resume content.
- Nothing is persisted across page reloads by default. Closing or reloading
  the tab discards your in-progress resume. (An opt-in draft autosave is on
  the roadmap; see below.)
- There are no analytics, trackers, or third-party scripts.

## Security

Uploaded and pasted Markdown is treated as **untrusted input** and is run
through a defensive pipeline before anything reaches the DOM:

1. **`gray-matter`** — extracts YAML frontmatter from the Markdown source.
2. **`marked`** — renders the Markdown body to HTML with GitHub Flavored
   Markdown (GFM) enabled.
3. **`DOMPurify`** — sanitizes the rendered HTML before it is inserted into
   the page.

The sanitization step blocks dangerous constructs, including:

- Tags such as `script`, `iframe`, `object`, `embed`, and `form`.
- Inline event-handler attributes (`onclick`, `onerror`, and similar).
- `javascript:` URLs.
- Inline `style` attributes.

In addition, a **Content Security Policy** is applied via a `<meta>` tag in
the base layout: `script-src` is restricted to the app's own origin,
`object-src` is `none`, `form-action` is `none`, and `frame-ancestors` is
`none`. The exported standalone HTML file is likewise dependency-free — it
contains no scripts and makes no network requests.

## Features

- Markdown resume rendering with GFM support.
- File upload **and** paste/type editing.
- Live preview.
- 545 OKLCH terminal themes, with an optional "resume-safe" contrast filter.
- Print-friendly output with a dedicated `@media print` stylesheet.
- Three export formats: Markdown (`.md`), standalone HTML (`.html`), and
  theme CSS (`.css`).
- Shareable theme-only links.
- Strict TypeScript throughout; no runtime backend.

## Local development

Requires Node.js `>= 22.12.0`.

```sh
# Install dependencies
npm install

# Start the dev server (default: http://localhost:4321)
npm run dev
```

### Build & preview

```sh
# Produce the static site in dist/
npm run build

# Serve the built output locally
npm run preview
```

### Quality scripts

```sh
# Type-check Astro, TypeScript, and components
npm run check

# Lint the project
npm run lint

# Format the project with Prettier
npm run format
```

## Deployment

The site is built as fully static output and deployed to **GitHub Pages** via
GitHub Actions. The workflow lives at
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): it builds the
site with `withastro/action` and publishes it with `actions/deploy-pages` on
every push to `main` (and on manual dispatch).

The published site lives at
<https://williamzujkowski.github.io/works-on-my-resume/>. The `site` and
`base` values are configured in `astro.config.mjs`.

## Theme system

Themes are sourced from the
[`@williamzujkowski/oklch-terminal-themes`](https://github.com/williamzujkowski/oklch-terminal-themes)
dataset — **545 OKLCH terminal color schemes**, vendored into the repository
so the app needs no network access at runtime.

Each terminal theme is normalized into a small set of **semantic resume
tokens** (background, foreground, muted, accent, accent-2, border, card, code
background). The resume renderer consumes only these tokens — never raw
terminal color slots — so any theme can drive the layout. Each theme also
ships precomputed WCAG contrast metadata, which powers the optional
"resume-safe themes only" filter.

## Roadmap

The MVP focuses on render, theme, print, and export. Post-MVP work is tracked
in the repository's **GitHub issues and milestones**, and includes ideas such
as:

- JSON Resume import/export.
- Theme contrast scoring surfaced in the UI.
- Additional layout templates.
- An ATS (applicant tracking system) preview mode.
- Opt-in draft autosave to local storage.
- ZIP export bundling Markdown, HTML, and theme CSS together.

## Tech stack

- **[Astro](https://astro.build/)** — static site framework.
- **TypeScript** — strict mode throughout.
- **React** — used as a single interactive island for the editor/preview UI.
- **[marked](https://marked.js.org/)** — Markdown → HTML rendering (GFM).
- **[gray-matter](https://github.com/jonschlinkert/gray-matter)** — YAML
  frontmatter parsing.
- **[DOMPurify](https://github.com/cure53/DOMPurify)** — HTML sanitization.

## License

Released under the [MIT License](LICENSE).

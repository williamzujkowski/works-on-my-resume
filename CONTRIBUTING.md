# Contributing

Thanks for thinking about contributing to **Works on My Resume**.

This is a small, opinionated project (a static, local-first Markdown resume
renderer with OKLCH themes). The goal is to keep it brutally simple, deeply
private, and well-crafted. Contributions in that spirit are very welcome.

## Before you start coding

**Comment on the issue first.** Drop a quick "I'd like to take this" on the
issue you want to tackle and wait for an acknowledgement. This avoids the
most common contribution-failure mode here: someone (often the maintainer)
already started, and your PR gets superseded before review. If you don't
hear back in a few days, please nudge.

If you have an idea that isn't tracked yet, open an issue describing it
_before_ writing the code, so we can talk through the approach.

## Issue labels you'll see

| Label              | Meaning                                                              |
| ------------------ | -------------------------------------------------------------------- |
| `good-first-issue` | Small, well-scoped — a good entry point for first-time contributors. |
| `mvp`              | Required for the MVP acceptance criteria (mostly closed).            |
| `post-mvp`         | Tracked but deliberately deferred from the MVP.                      |
| `design`           | Visual craft.                                                        |
| `ux`               | Interaction / journey / accessibility.                               |
| `security`         | Touches the trust boundary (sanitizer, CSP, untrusted input).        |
| `privacy`          | Affects the local-first guarantees.                                  |
| `themes`           | OKLCH theme engine.                                                  |
| `tech-debt`        | Known debt to revisit.                                               |
| `bug`              | Something doesn't work as documented.                                |
| `epic`             | Tracking issue spanning several children.                            |
| `under-review`     | A PR is being looked at — not ignored.                               |

## Local development

```bash
npm install
npm run dev        # local dev server
npm run build      # static production build
npm run check      # astro check (TypeScript strict)
npm run lint       # ESLint
npm run format     # Prettier
npm run test:e2e   # Playwright (also runs in CI on every push/PR)
```

Node **22.12+** is required.

## What stays true

This project is **static and local-first**, and we'd like to keep it that way.

- Resume content **never leaves the browser**. No backend, no analytics, no
  network calls carrying resume content. The one deliberate exception is the
  user-initiated "Import from Gist" flow (anonymous public-Gist fetch).
- Uploaded Markdown is **untrusted input**. The sanitizer pipeline
  (`src/utils/markdown.ts`) is the trust boundary; DOMPurify holds it.
- Anything that touches `src/utils/markdown.ts`, `astro.config.mjs`
  (the CSP), or adds a new network call needs extra scrutiny — please flag
  it explicitly in the PR description.
- **CSP gotcha — no React `style={...}`.** The built CSP is hash-based and
  does NOT include `style-src 'unsafe-inline'` (#38). A `style="..."` HTML
  attribute would be blocked. If a component needs to paint a runtime color,
  use a ref + `useLayoutEffect` and call `el.style.setProperty(...)` directly.
  CSSOM mutations from script are governed by `script-src`, not `style-src`,
  so they bypass the inline-style restriction. The `ThemeSwatch` and
  `AccentDot` helpers in `ThemePicker.tsx` and `ThemeControls.tsx` are the
  canonical pattern. Static styles belong in a CSS class, not inline.
- New npm dependencies need a clear reason and a license check. Prefer
  hand-rolling small things over pulling in a dep.

## PR etiquette

- One issue per PR; link it (`Closes #N`).
- Keep diffs focused — unrelated drive-by changes get pushed back.
- Make sure `check`, `lint`, and `test:e2e` are green locally.
- If your change is user-visible, update the README and/or `docs/` to match.

## External-PR review

PRs from outside contributors get an adversarial pass on top of the normal
code review: supply chain (new deps, install scripts), sanitizer/CSP
changes, network calls, hidden characters, and build/CI changes. It's
friendly but thorough — not personal.

## License

MIT. By contributing you agree your work ships under the same license.

Thanks again — small or large, the contribution is appreciated.

<!-- ci-ping: 2026-05-26 -->

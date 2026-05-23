/**
 * gist.ts — explicit, user-initiated import from a public GitHub Gist (#33).
 *
 * THE ONLY NETWORK CALL IN THIS APP THAT CARRIES NO RESUME DATA OUTBOUND
 * --------------------------------------------------------------------
 * The privacy posture of Works on My Resume is "nothing leaves the browser
 * unless the user explicitly asks". This module is the carefully-scoped
 * exception: when (and only when) the user pastes a gist URL and clicks
 * Import, we issue a single GET to GitHub's public Gists API. We:
 *
 *   - Send NO request body, NO custom headers beyond `Accept`, and NO auth.
 *     The endpoint is anonymous; the gist must be public.
 *   - Do not pass any resume content outbound — the request URL is just
 *     `https://api.github.com/gists/<id>`. The response is the gist body,
 *     which the user has chosen to import.
 *   - Surface friendly errors for the three failure modes that actually
 *     happen in practice: network down, gist not found / private (404),
 *     and the unauthenticated rate limit (403).
 *
 * The matching CSP relaxation (a single `https://api.github.com` entry in
 * the `connect-src` directive) lives in `src/layouts/BaseLayout.astro`.
 */

/**
 * Recognises both the canonical `https://gist.github.com/<user>/<id>` form
 * and the legacy `https://gist.github.com/<id>` shape. We tolerate any
 * trailing path segments (revision, "/raw", etc.) — we never click through
 * to them; we use the API. The id is the FIRST 32-hex-char component;
 * GitHub also accepts long alphanumeric ids, so we permit `a-f0-9` of any
 * length ≥ 5 to be future-tolerant.
 */
const GIST_URL_RE = /^https?:\/\/gist\.github\.com\/(?:[^/\s]+\/)?([a-f0-9]{5,})(?:[/?#].*)?$/i;

/** True when the input looks like a recognizable gist URL. */
export function isGistUrl(input: string): boolean {
  return parseGistUrl(input) !== null;
}

/**
 * Extract the gist id from a recognizable URL, or `null` if the input is
 * not a gist URL. Whitespace around the URL is forgiven; junk after a
 * trailing slash is ignored.
 */
export function parseGistUrl(input: string): { id: string } | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  const match = GIST_URL_RE.exec(trimmed);
  if (!match) return null;
  return { id: match[1] };
}

/** The narrow JSON shape we read from GitHub's Gists API response. */
interface GistApiFile {
  filename?: string;
  type?: string;
  language?: string;
  truncated?: boolean;
  content?: string;
  raw_url?: string;
}

interface GistApiResponse {
  files?: Record<string, GistApiFile | null>;
}

/**
 * Pick the file in a gist most likely to be the resume. Strategy:
 *   1. The first `.md` / `.markdown` file by filename (case-insensitive).
 *   2. Failing that, any file whose language is "Markdown".
 *   3. Failing that, the first file whose content is non-empty text.
 * Returns `null` if no candidate is found.
 */
function pickResumeFile(files: Record<string, GistApiFile | null>): GistApiFile | null {
  const entries = Object.values(files).filter(
    (f): f is GistApiFile => f !== null && f !== undefined,
  );
  if (entries.length === 0) return null;

  const markdownByExt = entries.find((f) => {
    const name = (f.filename ?? '').toLowerCase();
    return name.endsWith('.md') || name.endsWith('.markdown');
  });
  if (markdownByExt) return markdownByExt;

  const markdownByLang = entries.find((f) => (f.language ?? '').toLowerCase() === 'markdown');
  if (markdownByLang) return markdownByLang;

  return entries.find((f) => typeof f.content === 'string' && f.content.length > 0) ?? null;
}

/**
 * Issue a single anonymous GET to GitHub's Gists API and return the
 * Markdown body of the first markdown-shaped file in the gist.
 *
 * Throws a friendly `Error` on any failure mode — callers surface
 * `error.message` directly in the UI.
 *
 * @param url The gist URL the user pasted.
 */
export async function fetchGistMarkdown(
  url: string,
): Promise<{ markdown: string; filename: string }> {
  const parsed = parseGistUrl(url);
  if (!parsed) {
    throw new Error("That doesn't look like a Gist URL. Expected https://gist.github.com/…");
  }

  const apiUrl = `https://api.github.com/gists/${parsed.id}`;

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: 'GET',
      // `Accept` is the standard, recommended header for the v3 API. No
      // auth header, no body, no credentials.
      headers: { Accept: 'application/vnd.github+json' },
      // Defence in depth: do not send cookies, even if a future change
      // moved this to a same-origin proxy.
      credentials: 'omit',
      // Don't reuse a stale cache — the user just asked for the latest.
      cache: 'no-store',
    });
  } catch {
    // `fetch` rejects on network failure / CORS / DNS error / CSP block.
    throw new Error(
      "Couldn't reach GitHub to fetch that Gist. Check your connection and try again.",
    );
  }

  if (response.status === 404) {
    throw new Error('That Gist could not be found. Is the URL correct and the Gist public?');
  }
  if (response.status === 403) {
    // Anonymous rate limit is 60/hour per IP — extremely generous for a
    // user-driven import, but explain it clearly when it does happen.
    throw new Error(
      'GitHub is rate-limiting Gist requests from this network. Please try again in a few minutes.',
    );
  }
  if (!response.ok) {
    throw new Error(`GitHub returned an unexpected response (HTTP ${response.status}).`);
  }

  let data: GistApiResponse;
  try {
    data = (await response.json()) as GistApiResponse;
  } catch {
    throw new Error('That Gist response was not valid JSON. The Gist may be in an unusual state.');
  }

  if (!data.files || typeof data.files !== 'object') {
    throw new Error('That Gist did not contain any files.');
  }

  const file = pickResumeFile(data.files);
  if (!file) {
    throw new Error('That Gist had no Markdown or text content to import.');
  }

  if (typeof file.content !== 'string' || file.content.length === 0) {
    // GitHub truncates large files; surface that distinctly.
    if (file.truncated) {
      throw new Error('That Gist is too large to import via the API. Try downloading it manually.');
    }
    throw new Error('The chosen Gist file was empty.');
  }

  return {
    markdown: file.content,
    filename: file.filename ?? 'gist.md',
  };
}

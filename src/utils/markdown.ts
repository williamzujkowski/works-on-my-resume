/**
 * markdown.ts — the untrusted-Markdown → safe-HTML pipeline.
 *
 * SECURITY MODEL (layered, read this before touching anything below)
 * ------------------------------------------------------------------
 * Resume Markdown is UNTRUSTED user input. It is uploaded locally, never
 * touches a server, and is rendered straight into the DOM — so a malicious
 * (or merely sloppy) resume must not be able to run script or exfiltrate
 * data. We defend in two layers:
 *
 *   1. `marked` — renders Markdown to HTML. GitHub-Flavored Markdown allows
 *      raw HTML to pass through verbatim, so `marked`'s output is NOT safe
 *      on its own. `marked` is a *renderer*, not a security boundary.
 *
 *   2. `DOMPurify` — THE trust boundary. Every byte of HTML produced by
 *      `marked` is passed through DOMPurify with a restrictive allow-list
 *      before it is exposed as `ParsedResume.html`. Anything DOMPurify
 *      cannot vouch for (scripts, inline styles, event handlers, dangerous
 *      URI schemes, embedded frames) is stripped here.
 *
 * Optional YAML frontmatter is split off with a small regex and parsed with
 * `js-yaml` (a fully browser-safe parser; `js-yaml` v4's `load` is safe by
 * default). The frontmatter is structured data surfaced in the UI, never
 * injected as HTML.
 *
 * `parseResume` is fully SYNCHRONOUS and is intended to run only in the
 * browser (DOMPurify needs a real DOM). It never throws: every failure mode
 * degrades gracefully and, critically, NEVER returns unsanitized HTML.
 */

import yaml from 'js-yaml';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

import type { ResumeFrontmatter, ResumeLink, ParsedResume } from '../types';

/* ------------------------------------------------------------------ */
/* DOMPurify configuration                                             */
/* ------------------------------------------------------------------ */

/**
 * Tags a resume legitimately needs. This is an explicit allow-list: any tag
 * not named here (including ones not in DOMPurify's defaults) is dropped.
 */
const ALLOWED_TAGS = [
  // headings
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  // text & flow
  'p',
  'span',
  'div',
  'br',
  'hr',
  'blockquote',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'del',
  'ins',
  'sub',
  'sup',
  'mark',
  'small',
  // code
  'code',
  'pre',
  'kbd',
  'samp',
  // lists
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  // links & images
  'a',
  'img',
  // tables (GFM)
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
];

/** Attributes a resume legitimately needs. `style` is deliberately absent. */
const ALLOWED_ATTR = [
  'href',
  'src',
  'alt',
  'title',
  'id',
  'name',
  'class',
  'align',
  'colspan',
  'rowspan',
  'scope',
  // GFM task-list checkboxes render as disabled inputs; we forbid <input>
  // entirely (see FORBID_TAGS), so no checkbox-related attrs are needed.
];

/**
 * Tags that must never survive sanitization, even if some future change to
 * ALLOWED_TAGS would otherwise permit them. FORBID_TAGS wins over ALLOWED_TAGS,
 * so this is a belt-and-suspenders hard block on the dangerous set.
 */
const FORBID_TAGS = [
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'style',
  'link',
  'meta',
  'base',
];

/** Attributes that must never survive. `on*` handlers are covered separately. */
const FORBID_ATTR = ['style'];

/**
 * URI schemes permitted on `href`/`src`. DOMPurify blocks `javascript:` and
 * `vbscript:` by not listing them here. Note: `data:` URIs on `<img src>`
 * bypass this regex via DOMPurify's built-in `DATA_URI_TAGS` allowance — the
 * `afterSanitizeAttributes` hook below is what narrows those to raster images.
 * Relative URLs and fragments have no scheme and are always allowed.
 */
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

/** DOMPurify config object, frozen so it cannot be mutated at runtime. */
const PURIFY_CONFIG = Object.freeze({
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  FORBID_TAGS,
  FORBID_ATTR,
  ALLOWED_URI_REGEXP,
  // Block `on*` inline event handler attributes (onclick, onload, onerror …).
  ALLOW_ARIA_ATTR: false,
  ALLOW_DATA_ATTR: false,
  // Return a string, keep the document body content only.
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,
  // Forbid `javascript:`-style URLs everywhere as a second guard.
  SANITIZE_DOM: true,
  // Prefix any `id`/`name` from uploaded content with `user-content-` so a
  // malicious resume cannot clobber app element IDs or named DOM properties.
  SANITIZE_NAMED_PROPS: true,
});

/* ------------------------------------------------------------------ */
/* DOMPurify hooks                                                     */
/* ------------------------------------------------------------------ */

/**
 * Hooks are global to the DOMPurify instance, so we install them exactly
 * once. `sanitizeRemovedSomething` is a per-run flag flipped by the removal
 * hooks and read (then reset) by `sanitize()`.
 */
let hooksInstalled = false;
let sanitizeRemovedSomething = false;

/**
 * DOM tree-structure tags. DOMPurify parses the input inside a throwaway
 * document, so `uponSanitizeElement` fires for these scaffold elements even
 * on clean input — they are not user content and must not count as removals.
 */
const STRUCTURAL_TAGS = new Set(['html', 'head', 'body']);

function installHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;

  // Detect that the sanitizer dropped an element (e.g. a <script>).
  // `data.tagName` is lower-cased; pseudo-nodes such as `#text` and
  // `#comment` are not governed by the tag allow-list, so skip them —
  // counting them would flag every ordinary resume as "had content removed".
  DOMPurify.addHook('uponSanitizeElement', (_node, data) => {
    const tag = data.tagName;
    if (tag && !tag.startsWith('#') && !STRUCTURAL_TAGS.has(tag) && !data.allowedTags[tag]) {
      sanitizeRemovedSomething = true;
    }
  });

  // Detect that the sanitizer dropped an attribute (e.g. onclick, style).
  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (!data.keepAttr) {
      sanitizeRemovedSomething = true;
    }
  });

  // Harden links and re-permit data:image only on <img>.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return;
    const tag = node.tagName.toLowerCase();

    if (tag === 'a' && node.hasAttribute('href')) {
      const href = node.getAttribute('href') ?? '';
      // External http(s) links open in a new tab and must not leak the
      // opener or pass link equity to attacker-controlled pages.
      if (/^https?:\/\//i.test(href)) {
        node.setAttribute('rel', 'noopener noreferrer nofollow');
        node.setAttribute('target', '_blank');
      }
    }

    if (tag === 'img' && node.hasAttribute('src')) {
      const src = node.getAttribute('src') ?? '';
      // DOMPurify's DATA_URI_TAGS clause lets ANY `data:` URI through on
      // `<img src>` before ALLOWED_URI_REGEXP runs, so this hook is the real
      // filter. Allow only raster image data URIs — drop `data:image/svg+xml`
      // (SVG can carry markup) and every non-image `data:` URI.
      if (/^data:/i.test(src) && !/^data:image\/(?:png|jpe?g|gif|webp|avif)[;,]/i.test(src)) {
        node.removeAttribute('src');
        sanitizeRemovedSomething = true;
      }
    }
  });
}

/**
 * Run `marked` output through DOMPurify. This is the security boundary —
 * the returned string is safe to inject into the DOM.
 */
function sanitize(dirtyHtml: string): { clean: string; removed: boolean } {
  installHooks();
  sanitizeRemovedSomething = false;
  const clean = DOMPurify.sanitize(dirtyHtml, PURIFY_CONFIG) as string;
  return { clean, removed: sanitizeRemovedSomething };
}

/* ------------------------------------------------------------------ */
/* Frontmatter coercion                                                */
/* ------------------------------------------------------------------ */

/** Narrow an unknown value to a trimmed non-empty string, else undefined. */
function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

/**
 * Normalize a raw `links` value into `ResumeLink[]`. Accepts an array of
 * `{ label, url }` objects (extra keys ignored) or `{ "Label": "url" }`
 * single-key maps. Malformed entries are silently dropped — the contract
 * is permissive by design.
 */
function normalizeLinks(value: unknown): ResumeLink[] {
  if (!Array.isArray(value)) return [];
  const links: ResumeLink[] = [];

  for (const entry of value) {
    if (entry == null || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;

    let label = asString(record.label ?? record.name ?? record.title);
    let url = asString(record.url ?? record.href ?? record.link);

    // Support the terse `{ GitHub: "https://…" }` single-pair form.
    if ((label === undefined || url === undefined) && !('url' in record)) {
      const keys = Object.keys(record);
      if (keys.length === 1) {
        const onlyKey = keys[0];
        const onlyVal = asString(record[onlyKey]);
        if (onlyVal !== undefined) {
          label = label ?? onlyKey;
          url = url ?? onlyVal;
        }
      }
    }

    if (label !== undefined && url !== undefined) {
      links.push({ label, url });
    }
  }

  return links;
}

/**
 * Matches a leading YAML frontmatter block: a `---` line, the YAML body, and
 * a closing `---` line. Tolerates a BOM, CRLF line endings, and trailing
 * whitespace on the fence lines. Capture group 1 is the raw YAML.
 */
const FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Split optional leading YAML frontmatter from the Markdown body. This is a
 * pure string operation and never throws; parsing the YAML is done by the
 * caller so a malformed block degrades to "no frontmatter" + a warning.
 */
function splitFrontmatter(source: string): { yamlText: string | null; body: string } {
  const match = FRONTMATTER_RE.exec(source);
  if (!match) return { yamlText: null, body: source };
  return { yamlText: match[1], body: source.slice(match[0].length) };
}

/**
 * Coerce raw parsed YAML data into a `ResumeFrontmatter`. Known fields are
 * normalized; every unknown field is preserved verbatim (no rigid schema).
 */
function coerceFrontmatter(raw: unknown): ResumeFrontmatter {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const record = raw as Record<string, unknown>;

  // Start from a shallow copy so unknown fields survive untouched.
  const frontmatter: ResumeFrontmatter = { ...record };

  // Overwrite known string fields with normalized values (or delete if blank).
  for (const key of ['name', 'role', 'location', 'email', 'phone'] as const) {
    const coerced = asString(record[key]);
    if (coerced !== undefined) {
      frontmatter[key] = coerced;
    } else {
      delete frontmatter[key];
    }
  }

  // Normalize links; drop the field entirely when nothing valid remains.
  if ('links' in record) {
    const links = normalizeLinks(record.links);
    if (links.length > 0) {
      frontmatter.links = links;
    } else {
      delete frontmatter.links;
    }
  }

  return frontmatter;
}

/* ------------------------------------------------------------------ */
/* Frontmatter validation (optional, non-blocking)                     */
/* ------------------------------------------------------------------ */

/**
 * Frontmatter validation philosophy
 * ---------------------------------
 * The MVP has NO rigid schema and that is deliberate — unknown fields are
 * freely allowed and never warned about. But when a *known* field is present
 * and obviously wrong (a misspelled key, an `email` with no `@`, a `links`
 * value that is not a list) the user almost certainly made a typo, so a
 * gentle nudge is far more useful than silent coercion.
 *
 * Every check below is a SOFT warning: it is appended to `ParsedResume.warnings`
 * and nothing else. Validation never throws, never blocks rendering, and never
 * drops content — `coerceFrontmatter` has already done the lossy normalization;
 * this pass only *describes* what looked off, in friendly, actionable wording.
 */

/** The known top-level frontmatter keys, used for "did you mean" matching. */
const KNOWN_FRONTMATTER_KEYS = ['name', 'role', 'location', 'email', 'phone', 'links'] as const;

/** Scalar known keys that should hold a string-ish value. */
const SCALAR_FRONTMATTER_KEYS = ['name', 'role', 'location', 'phone', 'email'] as const;

/**
 * A deliberately loose "looks like an email" test. We are not RFC-5322
 * compliant on purpose — the goal is to catch obvious mistakes (a missing
 * `@`, a domain with no dot, stray whitespace), not to reject unusual but
 * legal addresses. False positives here would be worse than a missed catch.
 */
const PLAUSIBLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * URL schemes a resume link may legitimately use. Anything else (relative
 * paths and bare fragments included) is checked separately below.
 */
const PLAUSIBLE_URL_SCHEME_RE = /^(?:https?|mailto):/i;

/**
 * Compute the Damerau-Levenshtein edit distance between two strings, with an
 * early exit once the distance is known to exceed `max`. Used only for short
 * frontmatter keys, so the simple O(m*n) three-row implementation is plenty.
 *
 * We use the *optimal string alignment* variant of Damerau-Levenshtein, which
 * — unlike plain Levenshtein — counts an adjacent transposition (`naem` for
 * `name`) as a single edit. Transpositions are the single most common kind of
 * typo, so this materially improves the "did you mean" suggestions.
 *
 * The early exit keeps a pathological long key from doing real work and
 * lets callers express "near miss" as a small numeric threshold.
 */
function editDistance(a: string, b: string, max: number): number {
  // A length gap alone already exceeds the budget — no need to compute.
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;

  // Three rolling rows: `prev2` (i-2), `prev` (i-1) and `curr` (i). The
  // i-2 row is what makes the transposition check possible.
  let prev2 = new Array<number>(b.length + 1);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
      // Adjacent transposition: the last two characters are swapped.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, prev2[j - 2] + 1);
      }
      curr[j] = best;
      if (best < rowMin) rowMin = best;
    }
    // Whole row already over budget — distance can only grow from here.
    if (rowMin > max) return max + 1;
    [prev2, prev, curr] = [prev, curr, prev2];
  }

  return prev[b.length];
}

/**
 * Find the known frontmatter key that an unknown key is most likely a typo
 * of, or `undefined` when the key is not a near-miss of anything. The
 * threshold scales with key length so short keys (where one edit is a big
 * proportional change) are not over-eagerly "corrected".
 */
function suggestKnownKey(unknownKey: string): string | undefined {
  const candidate = unknownKey.trim().toLowerCase();
  if (candidate.length === 0) return undefined;

  // 1 edit for short keys, 2 for longer ones — enough to catch `naem`,
  // `tite`, `e-mail`, `phon`, `lnks` without matching unrelated words.
  const threshold = candidate.length <= 4 ? 1 : 2;

  let best: string | undefined;
  let bestDistance = threshold + 1;

  for (const known of KNOWN_FRONTMATTER_KEYS) {
    // An exact match is a known key, not an unknown one — skip it.
    if (known === candidate) return undefined;
    const distance = editDistance(candidate, known, threshold);
    if (distance <= threshold && distance < bestDistance) {
      best = known;
      bestDistance = distance;
    }
  }

  return best;
}

/** Quote a value for display inside a warning, truncating absurdly long ones. */
function quoteForWarning(value: unknown): string {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
  const clipped = text.length > 60 ? `${text.slice(0, 57)}…` : text;
  return `"${clipped}"`;
}

/** A friendly word for the JS type of an unexpected value. */
function describeType(value: unknown): string {
  if (value === null) return 'an empty value';
  if (Array.isArray(value)) return 'a list';
  return `a ${typeof value}`;
}

/**
 * Validate one raw `links` entry, pushing a friendly warning for the first
 * real problem found. `index` is 1-based for human-readable messages.
 */
function validateLinkEntry(entry: unknown, index: number, warnings: string[]): void {
  if (entry == null || typeof entry !== 'object') {
    warnings.push(
      `Frontmatter "links" entry #${index} isn't a link — expected a label and URL, got ${describeType(entry)}.`,
    );
    return;
  }

  const record = entry as Record<string, unknown>;
  let label = asString(record.label ?? record.name ?? record.title);
  let url = asString(record.url ?? record.href ?? record.link);

  // The terse single-pair form `{ GitHub: "https://…" }` is also valid.
  if ((label === undefined || url === undefined) && !('url' in record)) {
    const keys = Object.keys(record);
    if (keys.length === 1) {
      const onlyVal = asString(record[keys[0]]);
      if (onlyVal !== undefined) {
        // Mirror normalizeLinks: the lone key is the label, its value the URL.
        label = label ?? keys[0];
        url = url ?? onlyVal;
      }
    }
  }

  if (label === undefined && url === undefined) {
    warnings.push(
      `Frontmatter "links" entry #${index} is missing both a label and a URL, so it was skipped.`,
    );
    return;
  }
  if (label === undefined) {
    warnings.push(`Frontmatter "links" entry #${index} is missing a label, so it was skipped.`);
    return;
  }
  if (url === undefined) {
    warnings.push(
      `Frontmatter "links" entry #${index} ("${label}") is missing a URL, so it was skipped.`,
    );
    return;
  }

  // A URL is present — make sure its scheme is one the renderer can use.
  // Relative paths and fragments have no scheme and are intentionally fine.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(url);
  if (hasScheme && !PLAUSIBLE_URL_SCHEME_RE.test(url)) {
    warnings.push(
      `Frontmatter "links" entry #${index} ("${label}") has a URL that isn't http(s), ` +
        `mailto, or a relative path: ${quoteForWarning(url)}.`,
    );
  }
}

/**
 * Sanity-check parsed frontmatter and append friendly, actionable warnings
 * for anything that looks like a mistake. Runs AFTER `coerceFrontmatter`, so
 * `coerced` holds the normalized view and `raw` the original parsed YAML —
 * we inspect `raw` to catch problems that coercion would otherwise hide
 * (e.g. a numeric `name`, which coercion happily stringifies).
 *
 * This function only ever pushes strings onto `warnings`; it cannot throw.
 */
function validateFrontmatter(raw: unknown, coerced: ResumeFrontmatter, warnings: string[]): void {
  // Nothing object-shaped means nothing to validate (coercion already
  // returned `{}` and the caller will have warned about a bad parse).
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return;
  const record = raw as Record<string, unknown>;

  /* --- Scalar fields: present but not a string/number/boolean -------- */
  for (const key of SCALAR_FRONTMATTER_KEYS) {
    if (!(key in record)) continue;
    const value = record[key];
    // `asString` accepts strings, numbers and booleans; anything it rejects
    // (objects, arrays, null) is a value the user almost certainly mistyped.
    if (value != null && asString(value) === undefined) {
      warnings.push(
        `Frontmatter "${key}" should be text, but it's ${describeType(value)} — it was ignored.`,
      );
    }
  }

  /* --- email: present but doesn't look like an email address --------- */
  // Use the coerced value so a numeric/boolean email is compared as text;
  // a structurally-bad value was already warned about by the scalar check.
  if (typeof coerced.email === 'string' && !PLAUSIBLE_EMAIL_RE.test(coerced.email)) {
    warnings.push(
      `Frontmatter "email" doesn't look like an email address: ${quoteForWarning(coerced.email)}.`,
    );
  }

  /* --- links: present but not an array, or with bad entries ---------- */
  if ('links' in record) {
    const value = record.links;
    if (!Array.isArray(value)) {
      warnings.push(
        `Frontmatter "links" should be a list of links, but it's ${describeType(value)} — it was ignored.`,
      );
    } else {
      value.forEach((entry, i) => validateLinkEntry(entry, i + 1, warnings));
    }
  }

  /* --- unknown keys that are near-misses of a known key -------------- */
  // Unknown fields are allowed and NOT warned about in general; we only
  // speak up when a key looks like a typo of a known one.
  for (const key of Object.keys(record)) {
    if ((KNOWN_FRONTMATTER_KEYS as readonly string[]).includes(key)) continue;
    const suggestion = suggestKnownKey(key);
    if (suggestion !== undefined && !(suggestion in record)) {
      // Only suggest when the correct key isn't already present, so we
      // don't nag about an extra field that merely resembles one in use.
      warnings.push(`Frontmatter has an unknown key "${key}" — did you mean "${suggestion}"?`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Parse a raw Markdown resume string into structured, render-ready data.
 *
 * Synchronous and browser-only. Never throws: frontmatter problems and
 * sanitizer removals surface as `warnings`, and any hard failure returns
 * empty `html` rather than leaking unsanitized markup.
 *
 * @param input Raw uploaded Markdown (untrusted).
 * @returns A `ParsedResume` with sanitized HTML safe to inject into the DOM.
 */
export function parseResume(input: string): ParsedResume {
  const warnings: string[] = [];

  // Guard against non-string callers despite the typed signature.
  const source = typeof input === 'string' ? input : '';

  /* --- Step 1: split optional YAML frontmatter from the body --------- */
  // The split is a pure regex op; only the YAML parse can fail, and when it
  // does the body (already stripped of the frontmatter block) still renders.
  let frontmatter: ResumeFrontmatter;
  const { yamlText, body } = splitFrontmatter(source);
  if (yamlText !== null && yamlText.trim().length > 0) {
    try {
      const rawFrontmatter = yaml.load(yamlText);
      frontmatter = coerceFrontmatter(rawFrontmatter);
      // Optional, non-blocking sanity checks. Runs only once the YAML has
      // parsed and coerced cleanly; appends friendly warnings, never throws.
      validateFrontmatter(rawFrontmatter, frontmatter, warnings);
    } catch (error) {
      frontmatter = {};
      const detail = error instanceof Error ? error.message : String(error);
      warnings.push(`Frontmatter could not be parsed and was ignored (${detail}).`);
    }
  } else {
    frontmatter = {};
  }

  /* --- Step 2: render the body with GFM-enabled marked --------------- */
  // Empty body short-circuits to empty HTML (no render, no sanitize).
  if (body.trim().length === 0) {
    return { frontmatter, body, html: '', warnings };
  }

  let renderedHtml: string;
  try {
    // `async: false` makes `marked.parse` return a string synchronously.
    renderedHtml = marked.parse(body, { async: false, gfm: true });
  } catch (error) {
    // Fail safe: a renderer crash must never yield unsanitized HTML.
    const detail = error instanceof Error ? error.message : String(error);
    return {
      frontmatter,
      body,
      html: '',
      warnings: [...warnings, `Markdown could not be rendered (${detail}).`],
    };
  }

  /* --- Step 3: sanitize — THE trust boundary ------------------------- */
  try {
    const { clean, removed } = sanitize(renderedHtml);
    if (removed) {
      warnings.push(
        'Some unsafe content (e.g. scripts or inline styles) was removed during sanitization.',
      );
    }
    return { frontmatter, body, html: clean, warnings };
  } catch (error) {
    // If DOMPurify itself fails, return NO html — never the unsafe input.
    const detail = error instanceof Error ? error.message : String(error);
    return {
      frontmatter,
      body,
      html: '',
      warnings: [...warnings, `Content could not be safely sanitized (${detail}).`],
    };
  }
}

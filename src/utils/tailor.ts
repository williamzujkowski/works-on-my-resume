/**
 * tailor.ts — local, AI-free job-description keyword overlap (#91).
 *
 * Pure functions, no React, no DOM, no network, no storage. Everything in
 * this file operates on plain strings; the React component owns the lifecycle
 * and feeds rendered preview `.textContent` in / matches out.
 *
 * Algorithm sketch
 * ----------------
 * `extractTerms(jdText)` returns a deduped, frequency-ranked list of terms
 * the JD is "really about". It is intentionally cheap and explainable —
 * stoplist + capitalization heuristic + bigrams — rather than statistical
 * (no TF-IDF corpus, no embeddings). The trade-off is acceptable: we get
 * "Kubernetes" / "incident response" / "Postgres" out of typical SRE / dev
 * job posts, and ignore "looking for a strong, passionate team player".
 *
 *   1. Tokenize on whitespace + punctuation. Keep tokens of length ≥ 2.
 *   2. Drop stopwords — common English words PLUS generic resume / JD
 *      vocabulary (`experience`, `team`, `ability`, `strong`, etc.).
 *   3. Capitalized-noun heuristic: a token that appears capitalized in the
 *      source is kept as a unigram candidate, UNLESS its lowercase form ALSO
 *      appears elsewhere as a regular lowercase word (in which case it was
 *      probably just sentence-starting — demote).
 *   4. Bigrams: every adjacent pair where neither token is a stopword and
 *      at least one is capitalized, OR the bigram appears ≥ 2 times.
 *   5. Sort by frequency desc, then alphabetic.
 *
 * `matchResume(terms, resumeText)` is a case-insensitive substring scan over
 * the resume's rendered text. Resume text is the preview pane's
 * `.textContent`, NOT raw Markdown, because that is what the recruiter
 * actually reads.
 *
 * Trust boundary
 * --------------
 * The JD is user-typed text; treat it as untrusted. This module never emits
 * HTML — it returns `string` and `TailorMatch` objects with primitive
 * fields. The React layer is responsible for rendering JD-derived text only
 * inside `.textContent` (never `innerHTML`).
 */

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

/** Whether a term is a single token or a two-token phrase. */
export type TailorTermKind = 'unigram' | 'bigram';

/** A term extracted from a JD. */
export interface TailorTerm {
  /** The normalized (lowercase) form used for matching. */
  term: string;
  /** A pretty form to render in the UI — original casing from the JD. */
  displayTerm: string;
  /** Number of times the term appears in the JD. */
  frequency: number;
  /** Whether this is a single token or a bigram phrase. */
  kind: TailorTermKind;
}

/** A term's match status against the resume text. */
export interface TailorMatch {
  /** The originating term. */
  term: TailorTerm;
  /** True iff the term was found in the resume text (case-insensitive). */
  matched: boolean;
  /** Number of occurrences in the resume (0 when `matched` is false). */
  occurrences: number;
}

/** Aggregate over a list of matches — useful for the "hit rate" chip. */
export interface TailorOverlapSummary {
  /** matched-count / total-count, in [0, 1]. */
  hitRate: number;
  /** Up to `n` terms that did NOT match the resume, ranked by JD frequency. */
  topGaps: TailorTerm[];
}

/* ------------------------------------------------------------------ */
/* Stopwords                                                           */
/* ------------------------------------------------------------------ */

/**
 * Stopwords — common English words plus generic resume / JD vocabulary that
 * adds no signal to a tailoring exercise. The list is intentionally
 * hand-curated: a bigger list would start dropping real terms (e.g.
 * "experience" alone is noise, but "data engineer experience" is meaningful
 * — the bigram check catches that since `data` and `engineer` are kept).
 *
 * Lowercase entries only. Lookups are case-insensitive on the normalized
 * token.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  // English function words.
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'if',
  'then',
  'else',
  'when',
  'while',
  'of',
  'at',
  'by',
  'for',
  'with',
  'about',
  'against',
  'between',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'to',
  'from',
  'up',
  'down',
  'in',
  'out',
  'on',
  'off',
  'over',
  'under',
  'again',
  'further',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'having',
  'do',
  'does',
  'did',
  'doing',
  'will',
  'would',
  'should',
  'could',
  'can',
  'may',
  'might',
  'must',
  'shall',
  'as',
  'so',
  'than',
  'too',
  'very',
  'just',
  'now',
  'this',
  'that',
  'these',
  'those',
  'we',
  'you',
  'they',
  'he',
  'she',
  'it',
  'i',
  'me',
  'my',
  'our',
  'your',
  'their',
  'his',
  'her',
  'its',
  'who',
  'what',
  'which',
  'whose',
  'whom',
  'not',
  'no',
  'nor',
  'only',
  'own',
  'same',
  'such',
  'any',
  'each',
  'all',
  'both',
  'most',
  'more',
  'some',
  'few',
  'other',
  'another',
  // Generic resume / JD chrome.
  'experience',
  'experienced',
  'team',
  'teams',
  'ability',
  'abilities',
  'strong',
  'excellent',
  'good',
  'great',
  'proven',
  'role',
  'roles',
  'work',
  'working',
  'works',
  'worked',
  'job',
  'jobs',
  'position',
  'positions',
  'opportunity',
  'opportunities',
  'candidate',
  'candidates',
  'applicant',
  'applicants',
  'looking',
  'seeking',
  'required',
  'requirements',
  'requirement',
  'responsibilities',
  'responsibility',
  'qualifications',
  'qualification',
  'skill',
  'skills',
  'knowledge',
  'understanding',
  'familiar',
  'familiarity',
  'years',
  'year',
  'plus',
  'minimum',
  'preferred',
  'must',
  'should',
  'will',
  'company',
  'companies',
  'environment',
  'environments',
  'culture',
  'business',
  'product',
  'products',
  'project',
  'projects',
  'people',
  'person',
  'member',
  'members',
  'staff',
  'employee',
  'employees',
  'manager',
  'managers',
  'leader',
  'leaders',
  'leadership',
  'including',
  'include',
  'includes',
  'such',
  'etc',
  'e.g',
  'i.e',
  'use',
  'using',
  'used',
  'help',
  'helps',
  'helping',
  'helped',
  'support',
  'supports',
  'supporting',
  'supported',
  'across',
  'within',
  'around',
  'among',
  'new',
  'great',
  'best',
  'top',
  'high',
  'low',
  'level',
  'levels',
  'senior',
  'junior',
  'mid',
  'lead',
  'principal',
  'staff',
  'us',
  'them',
  'about',
  'also',
  'well',
  'like',
  'looking',
  'someone',
  'everyone',
  'anything',
  'something',
  'one',
  'two',
  'three',
  'four',
  'five',
  'many',
  'much',
  'lot',
  'lots',
]);

/* ------------------------------------------------------------------ */
/* Tokenization                                                         */
/* ------------------------------------------------------------------ */

/**
 * A single token from the source plus its original casing. We keep both
 * because the case decides whether the unigram heuristic accepts the token,
 * but match-matching always operates on the normalized lowercase form.
 */
interface Token {
  /** Lowercased form — the key used for stopword lookup and dedupe. */
  norm: string;
  /** Original casing from the source — used for `displayTerm`. */
  raw: string;
  /** True iff the original token started with an uppercase letter. */
  capitalized: boolean;
  /** True iff the original token was ALL uppercase (e.g. `AWS`). */
  allCaps: boolean;
}

/**
 * Tokenize on whitespace + punctuation, keeping tokens of length ≥ 2.
 *
 * Punctuation classes we DO want to keep as token-internal:
 *  - `'` (apostrophe) — preserve `don't`, `team's` so the stopword can match
 *  - `-` (hyphen) — preserve `infrastructure-as-code`, `on-call`
 *  - `+` (plus) — preserve `c++`, `notion+jira`
 *  - `.` (dot) — preserve `node.js`, `next.js`
 *  - `/` (slash) — preserve `ci/cd`, `tcp/ip`
 *
 * Everything else is treated as a token boundary.
 */
function tokenize(text: string): Token[] {
  // The regex describes ONE token: a run of word chars / dots / slashes /
  // pluses / hyphens / apostrophes. The `g` flag steps through the source.
  // `\p{L}` and `\p{N}` (Unicode letters / numbers) cover non-ASCII names
  // gracefully — a JD that mentions `Café` or `Æther` still tokenizes.
  const re = /[\p{L}\p{N}][\p{L}\p{N}.'+/-]*/gu;
  const out: Token[] = [];
  for (const match of text.matchAll(re)) {
    const raw = match[0];
    if (raw.length < 2) continue;
    // Trim trailing punctuation that the regex grabbed at the end —
    // `Kubernetes.` keeps its `s` but drops the `.`. Without this every
    // sentence-final word would become its own variant of itself.
    const trimmed = raw.replace(/[.'+/-]+$/u, '');
    if (trimmed.length < 2) continue;
    const norm = trimmed.toLowerCase();
    const firstChar = trimmed[0];
    const capitalized = firstChar !== firstChar.toLowerCase();
    const allCaps = trimmed.length >= 2 && trimmed === trimmed.toUpperCase();
    out.push({ norm, raw: trimmed, capitalized, allCaps });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Term extraction                                                     */
/* ------------------------------------------------------------------ */

/**
 * Frequency-bucketed running tally for a candidate term. The display form
 * is held alongside the count so we can prefer the prettiest casing we
 * saw (e.g. `AWS` over `aws` if both appear, or `Kubernetes` over
 * `kubernetes`).
 */
interface TermAccumulator {
  norm: string;
  display: string;
  count: number;
  kind: TailorTermKind;
}

/** Stable comparator: frequency desc, then display alphabetic. */
function compareTerms(a: TailorTerm, b: TailorTerm): number {
  if (b.frequency !== a.frequency) return b.frequency - a.frequency;
  return a.displayTerm.localeCompare(b.displayTerm);
}

/**
 * Pick the prettier of two casings for the same lowercase form. The rule:
 * an all-caps form (`AWS`) beats an initial-cap form (`Aws`), which beats
 * a lowercase form (`aws`). Ties go to the longer string, which is a
 * reasonable proxy for "more specific".
 */
function preferredDisplay(a: string, b: string): string {
  const score = (s: string): number => {
    if (s === s.toUpperCase() && /[A-Z]/.test(s)) return 3;
    if (s[0] === s[0].toUpperCase() && s[0] !== s[0].toLowerCase()) return 2;
    return 1;
  };
  const sa = score(a);
  const sb = score(b);
  if (sa !== sb) return sa > sb ? a : b;
  return a.length >= b.length ? a : b;
}

/**
 * Extract a deduped, frequency-ranked list of terms the JD is "about".
 *
 * @example
 *   const terms = extractTerms(`
 *     Senior Platform Engineer. Experience with Kubernetes, Postgres,
 *     and incident response. We use Postgres heavily.
 *   `);
 *   // terms[0].displayTerm === 'Postgres' (frequency 2)
 *   // terms.some(t => t.term === 'kubernetes') === true
 *   // terms.some(t => t.term === 'incident response') === true
 */
export function extractTerms(jdText: string): TailorTerm[] {
  if (!jdText || jdText.trim().length === 0) return [];

  const tokens = tokenize(jdText);

  /* Pass 1: count the lowercase frequency of EVERY non-stopword token.
     We need this to (a) feed unigram candidates and (b) drive the bigram
     "appears ≥ 2 times" rule, and (c) demote capitalized tokens that ALSO
     appear lowercase elsewhere — those are sentence-starters, not nouns. */
  const tokenCounts = new Map<string, number>();
  const lowercaseHits = new Map<string, number>();
  const displays = new Map<string, string>();
  for (const t of tokens) {
    if (STOPWORDS.has(t.norm)) continue;
    tokenCounts.set(t.norm, (tokenCounts.get(t.norm) ?? 0) + 1);
    if (!t.capitalized) {
      lowercaseHits.set(t.norm, (lowercaseHits.get(t.norm) ?? 0) + 1);
    }
    const prev = displays.get(t.norm);
    displays.set(t.norm, prev ? preferredDisplay(prev, t.raw) : t.raw);
  }

  /* Pass 2: collect unigram candidates. A unigram qualifies if it is
     capitalized somewhere AND is NOT predominantly lowercase elsewhere.
     "Predominantly lowercase" = the lowercase form appears at least as
     often as the capitalized form (sentence-starter sniffing). All-caps
     forms (`AWS`, `SLA`) always qualify — they are never sentence-starters
     because acronyms don't lose their caps mid-sentence. */
  const acc = new Map<string, TermAccumulator>();
  const seenCapitalized = new Map<string, { capCount: number; allCapsSeen: boolean }>();
  for (const t of tokens) {
    if (STOPWORDS.has(t.norm)) continue;
    if (!t.capitalized) continue;
    const prev = seenCapitalized.get(t.norm) ?? { capCount: 0, allCapsSeen: false };
    prev.capCount += 1;
    if (t.allCaps) prev.allCapsSeen = true;
    seenCapitalized.set(t.norm, prev);
  }
  for (const [norm, { capCount, allCapsSeen }] of seenCapitalized.entries()) {
    const lower = lowercaseHits.get(norm) ?? 0;
    // Acronyms ALWAYS qualify (allCapsSeen). Otherwise we need the
    // capitalization to dominate — strict greater-than, so a single `In` at
    // the start of a sentence doesn't sneak through.
    if (!allCapsSeen && lower >= capCount) continue;
    acc.set(norm, {
      norm,
      display: displays.get(norm) ?? norm,
      count: tokenCounts.get(norm) ?? capCount,
      kind: 'unigram',
    });
  }

  /* Pass 3: bigrams. Scan adjacent pairs in the token stream; keep the
     pair if neither token is a stopword and (at least one is capitalized
     OR the lowercase pair appears ≥ 2 times). The bigram's display form
     uses the preferred casings of its two parts. */
  const bigramCounts = new Map<string, number>();
  const bigramDisplays = new Map<string, string>();
  const bigramHasCap = new Map<string, boolean>();
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (STOPWORDS.has(a.norm) || STOPWORDS.has(b.norm)) continue;
    const key = `${a.norm} ${b.norm}`;
    bigramCounts.set(key, (bigramCounts.get(key) ?? 0) + 1);
    const display = `${displays.get(a.norm) ?? a.raw} ${displays.get(b.norm) ?? b.raw}`;
    bigramDisplays.set(key, display);
    if (a.capitalized || b.capitalized) bigramHasCap.set(key, true);
  }
  for (const [key, count] of bigramCounts.entries()) {
    const hasCap = bigramHasCap.get(key) ?? false;
    if (!hasCap && count < 2) continue;
    acc.set(key, {
      norm: key,
      display: bigramDisplays.get(key) ?? key,
      count,
      kind: 'bigram',
    });
  }

  /* Materialize and sort. */
  const out: TailorTerm[] = [];
  for (const a of acc.values()) {
    out.push({
      term: a.norm,
      displayTerm: a.display,
      frequency: a.count,
      kind: a.kind,
    });
  }
  out.sort(compareTerms);
  return out;
}

/* ------------------------------------------------------------------ */
/* Resume matching                                                     */
/* ------------------------------------------------------------------ */

/**
 * Case-insensitive substring count of `needle` in `haystack`. Uses a manual
 * `indexOf` scan rather than a regex so JD terms with regex-special
 * characters (`C++`, `.NET`, `Node.js`) match literally — without the
 * scan-then-escape ceremony.
 *
 * Bigrams match across any whitespace run in the resume: we normalize the
 * resume's whitespace to single spaces before counting, so "incident
 * response" matches even if the resume has "incident\n  response" across a
 * line break. Single tokens are unaffected.
 */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let count = 0;
  let from = 0;
  while (true) {
    const idx = h.indexOf(n, from);
    if (idx === -1) break;
    count += 1;
    from = idx + n.length;
  }
  return count;
}

/**
 * For each term, count its case-insensitive occurrences in the resume.
 *
 * `resumeText` should be the rendered preview's `.textContent` — i.e. what
 * the reader actually sees — NOT the raw Markdown. This keeps the matcher
 * honest about identity-header / frontmatter content that lives outside the
 * Markdown body.
 *
 * @example
 *   const terms = extractTerms('Kubernetes, Postgres, Salesforce.');
 *   const matches = matchResume(terms, 'I have shipped Kubernetes ...');
 *   // matches.find(m => m.term.term === 'kubernetes').matched === true
 *   // matches.find(m => m.term.term === 'salesforce').matched === false
 */
export function matchResume(terms: TailorTerm[], resumeText: string): TailorMatch[] {
  // Collapse whitespace so bigrams match across line breaks.
  const normalizedResume = resumeText.replace(/\s+/g, ' ');
  const out: TailorMatch[] = [];
  for (const term of terms) {
    const occurrences = countOccurrences(normalizedResume, term.term);
    out.push({ term, matched: occurrences > 0, occurrences });
  }
  return out;
}

/**
 * Summarize a list of matches: the overall hit-rate and the top-N gaps
 * (terms NOT in the resume), ranked by JD frequency.
 *
 * @example
 *   const summary = summarizeOverlap(matches, 8);
 *   // summary.hitRate ∈ [0, 1]
 *   // summary.topGaps.length <= 8
 */
export function summarizeOverlap(matches: TailorMatch[], maxGaps = 8): TailorOverlapSummary {
  if (matches.length === 0) return { hitRate: 0, topGaps: [] };
  const matched = matches.filter((m) => m.matched).length;
  const gaps = matches.filter((m) => !m.matched).map((m) => m.term);
  // `matches` is already in extraction order (freq desc, alpha tiebreak),
  // and we filtered without reordering, so slicing is enough.
  return {
    hitRate: matched / matches.length,
    topGaps: gaps.slice(0, Math.max(0, maxGaps)),
  };
}

/**
 * Format a hit-rate as `X / Y (Z%)`. Pure helper, used by the UI chip and
 * the aria-live announcement; lives here so the rounding rule (floor on
 * the percentage, so "34 of 100" reads as 34%, not 34.0%) is colocated
 * with the data it formats.
 *
 * @example
 *   formatHitRate(12, 35) === '12 / 35 (34%)'
 *   formatHitRate(0, 0) === '0 / 0 (0%)'
 */
export function formatHitRate(matched: number, total: number): string {
  const pct = total === 0 ? 0 : Math.floor((matched / total) * 100);
  return `${matched} / ${total} (${pct}%)`;
}

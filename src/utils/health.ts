/**
 * health.ts — Resume Health analysis (#85).
 *
 * Pure, browser-and-node-safe heuristics that read a Markdown resume plus
 * its `ParsedResume` and emit a stage-aware `HealthReport`. Every check is
 * intentionally permissive: when a signal can't be evaluated (e.g. there
 * is no Experience section, so "bullets per role" doesn't apply) the
 * heuristic returns no findings rather than throwing.
 *
 * Design notes
 * ------------
 * - The rubric is opinion, not law. Findings are surfaced as warnings the
 *   author can dismiss in their head — never blocking, never destructive.
 * - The score is a quick at-a-glance number, not a job verdict. We start
 *   at 100, subtract per finding, and floor at 0. The formula is below.
 * - Stage tuning lives next to the thresholds it tunes (`STAGE_LIMITS`,
 *   weight knobs at the bottom) so the rubric reads top-to-bottom rather
 *   than scattering its calibration across the file.
 * - Operates on the raw Markdown string for line-accurate findings; the
 *   `ParsedResume` is only used for `frontmatter` shape.
 */

import type { ParsedResume } from '../types';

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

/** Career-stage rubric the Resume Health panel scores against. */
export type CareerStage = 'junior' | 'mid' | 'senior';

/** Severity of a single finding, from "you're good" to "fix this". */
export type HealthSeverity = 'good' | 'warn' | 'bad';

/**
 * Hint to the UI about what action to surface alongside a finding (#115).
 *
 * Two shapes:
 *  - `rewrite` — the finding has a templated fix. The `bulletText` is the
 *    full bullet source line the editor should rewrite through
 *    `getRewriteCandidates`. The Health panel surfaces a "Suggest a fix"
 *    affordance that opens an inline tray of 2-3 candidate rewrites;
 *    clicking a candidate inserts a sibling bullet through the same
 *    value/onChange path the in-editor rewrite tray (#93) uses. Nothing
 *    is mutated until the user picks.
 *  - `example` — the finding has no templated fix, but a hand-picked
 *    section name from the bundled sample resume teaches the pattern.
 *    The Health panel surfaces an "Open an example" affordance that
 *    selects/scrolls the example section into view in the editor textarea.
 */
export type HealthSuggestion =
  | { kind: 'rewrite'; bulletText: string }
  | { kind: 'example'; section: string };

/** A single piece of feedback from the analyzer. */
export interface HealthFinding {
  /** Stable id of the rule that produced this finding (e.g. `weak-verb`). */
  id: string;
  severity: HealthSeverity;
  message: string;
  /** 1-based line in the source Markdown, when the finding has a location. */
  line?: number;
  /**
   * Exact substring of the source line the UI should highlight (selection +
   * scroll). Optional: when omitted the UI falls back to selecting the
   * entire line at `line`.
   */
  offender?: string;
  /**
   * UI-facing hint for "Suggest a fix" / "Open an example" affordances
   * (#115). Optional: omitted on findings the UI cannot act on directly
   * (e.g. frontmatter missing-key warnings — the user fixes those in the
   * frontmatter block, which the UI already jumps to).
   */
  suggest?: HealthSuggestion;
}

/** The full output of `analyzeResume`. */
export interface HealthReport {
  stage: CareerStage;
  /** Composite score, 0–100. Higher is better. */
  score: number;
  findings: HealthFinding[];
}

/* ------------------------------------------------------------------ */
/* Constants — thresholds and word lists                               */
/* ------------------------------------------------------------------ */

/** Rough words-per-page estimate. ~475 is industry shorthand. */
const WORDS_PER_PAGE = 475;

/** Required frontmatter fields. `links` is "at least one entry". */
const REQUIRED_FRONTMATTER_KEYS = ['name', 'role', 'email'] as const;

/** Stage-specific section requirements. Keys are matched case-insensitively. */
const REQUIRED_SECTIONS_BY_STAGE: Record<CareerStage, readonly string[]> = {
  junior: ['Education', 'Projects', 'Experience'],
  mid: ['Summary', 'Experience', 'Skills'],
  senior: ['Summary', 'Experience', 'Skills'],
};

/**
 * "Experience" and "Work" are interchangeable — the writing guide
 * recommends "Experience" but plenty of resumes ship "Work Experience"
 * or just "Work". `experienceLikeHeadings` covers all common variants
 * so the section check doesn't penalize idiomatic alternate spellings.
 */
const EXPERIENCE_LIKE = [
  'experience',
  'work experience',
  'work',
  'employment',
  'professional experience',
];

/** Page-length envelopes by stage. Values are float pages. */
const STAGE_LIMITS: Record<CareerStage, { warn: number; bad: number; label: string }> = {
  // Junior should fit on one page; we allow a smidge of slack before warning.
  junior: { warn: 1.0, bad: 1.1, label: '1 page' },
  mid: { warn: 1.9, bad: 2.0, label: '1–2 pages' },
  senior: { warn: 1.9, bad: 2.0, label: '1–2 pages' },
};

/** Quantification floors. Below the floor → warn. */
const QUANT_FLOOR: Record<CareerStage, number> = {
  junior: 0.35,
  mid: 0.5,
  senior: 0.5,
};

/** Bullet phrases that signal a passive, low-impact description. Matched case-insensitively at the start of a bullet. */
const WEAK_VERB_PHRASES = [
  'Responsible for',
  'Helped',
  'Worked on',
  'Assisted',
  'Participated in',
  'Involved in',
  'Duties included',
  'Tasked with',
];

/** First-person pronouns. `I` is case-sensitive; everything else is case-insensitive. */
const FIRST_PERSON_CI = ['my', 'we', 'our', "i'm"];

/** Buzzwords. Two or more hits across the whole document trips the finding. */
const BUZZWORDS = [
  'synergy',
  'synergize',
  'ninja',
  'rockstar',
  'guru',
  '10x',
  'evangelize',
  'leverage',
  'utilize',
  'passionate about',
  'team player',
  'detail-oriented',
  'results-driven',
  'go-getter',
  'thought leader',
];

/** Bullets-per-role envelope. Below `min` → thin, above `max` → noisy. */
const BULLETS_PER_ROLE = { min: 2, max: 6 };

/* ------------------------------------------------------------------ */
/* Small parsers — operate on raw Markdown                             */
/* ------------------------------------------------------------------ */

/** One Markdown line annotated with its 1-based line number. */
interface LineInfo {
  /** 1-based line number in the original source. */
  line: number;
  /** Line content, verbatim. */
  text: string;
}

/** A bullet line + its 1-based source line + its content with the marker stripped. */
interface Bullet extends LineInfo {
  /** The bullet's content (text after `- ` or `* `). */
  content: string;
}

/** Split Markdown into line records (1-based line numbers). */
function splitLines(markdown: string): LineInfo[] {
  // Normalize CRLF so the splitter returns one record per visual line.
  const normalized = markdown.replace(/\r\n?/g, '\n');
  const out: LineInfo[] = [];
  const parts = normalized.split('\n');
  for (let i = 0; i < parts.length; i++) {
    out.push({ line: i + 1, text: parts[i] });
  }
  return out;
}

/** Extract every `- ` / `* ` bullet at any indent, with its line number. */
function findBullets(lines: LineInfo[]): Bullet[] {
  const out: Bullet[] = [];
  // We don't bother distinguishing fenced code blocks here: a resume rarely
  // includes a long fenced block, and if it does the bullet rules are still
  // a reasonable read on the prose around it.
  for (const li of lines) {
    const m = /^[ \t]*[-*][ \t]+(.*)$/.exec(li.text);
    if (!m) continue;
    out.push({ line: li.line, text: li.text, content: m[1] });
  }
  return out;
}

/** A heading line with its level (1-6) and trimmed text. */
interface Heading extends LineInfo {
  level: number;
  title: string;
}

/** Extract every ATX heading (`# ` through `###### `). */
function findHeadings(lines: LineInfo[]): Heading[] {
  const out: Heading[] = [];
  for (const li of lines) {
    const m = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(li.text);
    if (!m) continue;
    out.push({ line: li.line, text: li.text, level: m[1].length, title: m[2].trim() });
  }
  return out;
}

/** Count words via the same simple split the spec calls for. */
function wordCount(markdown: string): number {
  // Strip the frontmatter block before counting so a long YAML header isn't
  // double-counted as resume prose. Matches the FRONTMATTER_RE in markdown.ts.
  const body = markdown.replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');
  return body.split(/\s+/).filter(Boolean).length;
}

/* ------------------------------------------------------------------ */
/* Heuristic implementations                                           */
/* ------------------------------------------------------------------ */

/** #1 length. */
function checkLength(markdown: string, stage: CareerStage): HealthFinding[] {
  const pages = Math.ceil(wordCount(markdown) / WORDS_PER_PAGE);
  // `pages` is integer-rounded; the threshold expression uses the raw float
  // so a 1.1-page resume reads as "1 page" but a 1.4-page one warns.
  const rawPages = wordCount(markdown) / WORDS_PER_PAGE;
  const limits = STAGE_LIMITS[stage];

  // No content yet — nothing to warn about.
  if (wordCount(markdown) === 0) return [];

  if (rawPages > limits.bad) {
    return [
      {
        id: 'length',
        severity: 'bad',
        message: `Your resume runs ~${pages}p. For a ${stage} resume, aim for ${limits.label}.`,
      },
    ];
  }
  if (rawPages > limits.warn) {
    return [
      {
        id: 'length',
        severity: 'warn',
        message: `Your resume runs ~${pages}p. For a ${stage} resume, aim for ${limits.label}.`,
      },
    ];
  }
  return [];
}

/** #2 frontmatter completeness. */
function checkFrontmatter(parsed: ParsedResume): HealthFinding[] {
  const findings: HealthFinding[] = [];
  const fm = parsed.frontmatter;

  for (const key of REQUIRED_FRONTMATTER_KEYS) {
    const value = fm[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      findings.push({
        id: 'frontmatter',
        severity: 'warn',
        message: `Missing \`${key}\` — recruiters and ATS expect it in the header.`,
      });
    }
  }

  // `links` should be present and have at least one entry.
  const links = fm.links;
  if (!Array.isArray(links) || links.length === 0) {
    findings.push({
      id: 'frontmatter',
      severity: 'warn',
      message: 'Missing `links` — recruiters and ATS expect it in the header.',
    });
  }

  return findings;
}

/** #3 sections. */
function checkSections(markdown: string, stage: CareerStage): HealthFinding[] {
  const lines = splitLines(markdown);
  const headings = findHeadings(lines).filter((h) => h.level === 1 || h.level === 2);
  // Lowercase set of every H1/H2 heading title.
  const titles = new Set(headings.map((h) => h.title.toLowerCase()));

  const requirements = REQUIRED_SECTIONS_BY_STAGE[stage];
  const findings: HealthFinding[] = [];

  for (const required of requirements) {
    const want = required.toLowerCase();
    let present: boolean;
    if (want === 'experience' || want === 'work') {
      // Either heading satisfies the experience requirement.
      present = EXPERIENCE_LIKE.some((alt) => titles.has(alt));
    } else {
      present = titles.has(want);
    }
    if (!present) {
      findings.push({
        id: 'sections',
        severity: 'warn',
        message: `A ${stage} resume should include a ${required} section.`,
      });
    }
  }

  return findings;
}

/**
 * #4 quantification.
 *
 * Counts only bullets that live under an Experience-style H2 heading, so a
 * clean senior resume doesn't get dinged because its Skills table, Selected
 * Writing list, or Education capstone bullets happen not to carry numbers.
 *
 * Section headings that qualify as Experience (case-insensitive, exact H2
 * title match): `Experience`, `Work`, `Work Experience`, `Employment`,
 * `Professional Experience`. See `EXPERIENCE_LIKE` for the canonical list.
 *
 * Back-compat: if the resume has NO Experience-style H2 at all (early
 * drafts, projects-only resumes, junior portfolios), the rule falls back
 * to its original behavior of counting every bullet in the document. This
 * keeps the heuristic useful before the Experience section is written.
 *
 * See issue #105 for the reasoning behind this scoping change.
 */
function checkQuantification(markdown: string, stage: CareerStage): HealthFinding[] {
  const lines = splitLines(markdown);
  const headings = findHeadings(lines);
  const allBullets = findBullets(lines);
  if (allBullets.length === 0) return [];

  // Walk the document and tag each bullet with the title of the H2 it sits
  // under. We don't need an H2→bullets map — a single pass that records
  // "current H2" while scanning is enough.
  const experienceBullets: Bullet[] = [];
  let hasExperienceH2 = false;
  const headingByLine = new Map<number, Heading>();
  for (const h of headings) headingByLine.set(h.line, h);

  let currentH2: Heading | null = null;
  for (const li of lines) {
    const h = headingByLine.get(li.line);
    if (h && h.level === 2) {
      currentH2 = h;
      if (isExperienceLikeH2(h)) hasExperienceH2 = true;
      continue;
    }
    if (h) continue; // ignore H1, H3+; only H2 toggles section context
    if (!isExperienceLikeH2(currentH2)) continue;
    const bullet = findBulletInLine(li);
    if (bullet) experienceBullets.push(bullet);
  }

  // Pick the bullet pool the ratio is computed against. With at least one
  // Experience H2 we only score the bullets inside those sections; without
  // one we fall back to every bullet so the heuristic still gives feedback
  // on partial drafts.
  const pool = hasExperienceH2 ? experienceBullets : allBullets;
  if (pool.length === 0) return [];

  const withDigits = pool.filter((b) => /\d/.test(b.content)).length;
  const ratio = withDigits / pool.length;
  const floor = QUANT_FLOOR[stage];

  if (ratio < floor) {
    const pct = Math.round(ratio * 100);
    return [
      {
        id: 'quantification',
        severity: 'warn',
        message: `Only ${pct}% of your bullets contain a number. Quantify outcomes where you can.`,
      },
    ];
  }
  return [];
}

/** True when an H2 heading reads as Experience-like (see `EXPERIENCE_LIKE`). */
function isExperienceLikeH2(h: Heading | null): boolean {
  if (!h || h.level !== 2) return false;
  return EXPERIENCE_LIKE.includes(h.title.toLowerCase());
}

/** #5 weak-verb openings. One finding per offending line. */
function checkWeakVerbs(markdown: string): HealthFinding[] {
  const lines = splitLines(markdown);
  const bullets = findBullets(lines);
  const findings: HealthFinding[] = [];

  for (const bullet of bullets) {
    // Skip Markdown emphasis markers (`**`, `_`) at the start so a bullet
    // that opens with **Bold** isn't excused from the weak-verb check.
    const content = bullet.content.replace(/^[*_~`]+/, '').trimStart();
    for (const phrase of WEAK_VERB_PHRASES) {
      // Case-insensitive prefix match on a word boundary.
      const re = new RegExp(`^${escapeRegExp(phrase)}\\b`, 'i');
      if (re.test(content)) {
        // The offender is the matched prefix from the ORIGINAL source line
        // (case preserved), so the editor selection lands on the exact span
        // the user typed — not on a normalized lowercase echo of it.
        const offender = findOffenderInLine(bullet.text, phrase);
        findings.push({
          id: 'weak-verb',
          severity: 'warn',
          message: `Line ${bullet.line} starts with '${phrase}' — replace with an outcome verb like Shipped, Reduced, Built.`,
          line: bullet.line,
          offender,
          // The full bullet source line is what bulletPatterns rewrites
          // (it parses the `- ` / `* ` prefix itself), so the editor can
          // re-derive the bullet shape without us re-encoding it here.
          suggest: { kind: 'rewrite', bulletText: bullet.text },
        });
        // Don't double-fire for a single bullet that matches more than one phrase.
        break;
      }
    }
  }

  return findings;
}

/**
 * Find a case-insensitive occurrence of `needle` inside `line` and return the
 * exact-cased slice from `line`. Used so the editor selection highlights the
 * substring the writer actually typed, not a normalized echo of the rule's
 * pattern. Returns `undefined` when the needle does not appear (defensive —
 * the caller has already proven a regex match).
 */
function findOffenderInLine(line: string, needle: string): string | undefined {
  const idx = line.toLowerCase().indexOf(needle.toLowerCase());
  if (idx === -1) return undefined;
  return line.slice(idx, idx + needle.length);
}

/** #6 first person. One finding per offending bullet line. */
function checkFirstPerson(markdown: string): HealthFinding[] {
  const lines = splitLines(markdown);
  const bullets = findBullets(lines);
  const findings: HealthFinding[] = [];

  // Case-sensitive `I` on a word boundary, plus case-insensitive `my|we|our|I'm`.
  // Done as two passes so the case rules stay obvious to a reader.
  for (const bullet of bullets) {
    const hit = findFirstPersonWord(bullet.content);
    if (hit) {
      findings.push({
        id: 'first-person',
        severity: 'warn',
        message: `Line ${bullet.line} uses first person ('${hit}'). Resumes are written in implied first person.`,
        line: bullet.line,
        offender: hit,
        // First-person doesn't have a one-shot mechanical rewrite — but the
        // sample resume's Selected Impact section is an opinionated example
        // of outcome-led, impersonal phrasing.
        suggest: { kind: 'example', section: 'Selected Impact' },
      });
    }
  }

  return findings;
}

/**
 * Find the first first-person token in a piece of text, or `null` for none.
 * Returns the exact-cased match so the warning quotes what the user wrote.
 */
function findFirstPersonWord(text: string): string | null {
  // Case-sensitive `I` (and `I'm` / `I'll` / `I'd` etc.).
  const sensitive = /\bI('m|'ll|'d|'ve)?\b/.exec(text);
  // Case-insensitive `my | we | our`.
  const insensitive = /\b(my|we|our)\b/i.exec(text);

  // If both matched, return whichever came first in the string.
  if (sensitive && insensitive) {
    return sensitive.index <= insensitive.index ? sensitive[0] : insensitive[0];
  }
  if (sensitive) return sensitive[0];
  if (insensitive) return insensitive[0];
  // Fall back to a case-insensitive `I'm` scan for completeness (covered by
  // `sensitive` above, but documented here so future readers don't wonder).
  for (const word of FIRST_PERSON_CI) {
    if (word === "i'm") continue; // handled by `sensitive` above
    const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

/** #7 buzzwords. Two or more hits → one finding listing them. */
function checkBuzzwords(markdown: string): HealthFinding[] {
  const hits: string[] = [];
  // Strip the frontmatter so a link labelled "Leverage" can't trip it.
  const body = markdown.replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');
  for (const word of BUZZWORDS) {
    const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
    if (re.test(body)) hits.push(word);
  }
  if (hits.length >= 2) {
    // Walk the body lines to attach the first hit's source line + literal
    // offender so the finding's "Jump to line" lands somewhere useful (#115).
    const fmEnd = frontmatterEndLine(markdown);
    const lines = splitLines(markdown);
    let firstHitLine: number | undefined;
    let firstHitOffender: string | undefined;
    outer: for (const li of lines) {
      if (li.line <= fmEnd) continue;
      for (const word of hits) {
        const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
        const m = re.exec(li.text);
        if (m) {
          firstHitLine = li.line;
          firstHitOffender = m[0];
          break outer;
        }
      }
    }
    return [
      {
        id: 'buzzwords',
        severity: 'warn',
        message: `Buzzwords detected (${hits.join(', ')}). Replace with concrete evidence.`,
        line: firstHitLine,
        offender: firstHitOffender,
        // Buzzwords don't carry a one-shot mechanical rewrite — point the
        // user at the sample's Summary, which deliberately avoids them.
        suggest: { kind: 'example', section: 'Summary' },
      },
    ];
  }
  return [];
}

/**
 * 1-based line number where the YAML frontmatter block ends, or `0` when the
 * document has no frontmatter. Used by checks that want to ignore the
 * frontmatter block without re-running the strip regex.
 */
function frontmatterEndLine(markdown: string): number {
  const re = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
  const m = re.exec(markdown);
  if (!m) return 0;
  // Count newlines in the matched span; the trailing `---` line is the last
  // frontmatter line and we want its 1-based line number.
  const normalized = m[0].replace(/\r/g, '');
  const lineCount = normalized.split('\n').length;
  return normalized.endsWith('\n') ? lineCount - 1 : lineCount;
}

/** #8 bullets per role. Groups bullets between H3 (or H2 if no H3). */
function checkBulletsPerRole(markdown: string): HealthFinding[] {
  const lines = splitLines(markdown);
  const headings = findHeadings(lines);
  const bullets = findBullets(lines);
  if (headings.length === 0 || bullets.length === 0) return [];

  // Walk top-down. Bullets belong to the nearest preceding H3, falling back
  // to the nearest preceding H2 when no H3 is open yet. Headings deeper than
  // H3 are ignored — they're sub-sections, not role boundaries.
  interface RoleGroup {
    heading: Heading;
    bullets: Bullet[];
  }
  const groups: RoleGroup[] = [];
  let currentH2: Heading | null = null;
  let currentH3: Heading | null = null;
  const headingByLine = new Map<number, Heading>();
  for (const h of headings) headingByLine.set(h.line, h);

  // Helper: open a new group keyed by the active heading (H3 if present, H2 otherwise).
  function openGroup(h: Heading): RoleGroup {
    const g: RoleGroup = { heading: h, bullets: [] };
    groups.push(g);
    return g;
  }

  let currentGroup: RoleGroup | null = null;
  const seenH3UnderH2 = new Set<number>();

  for (const li of lines) {
    const h = headingByLine.get(li.line);
    if (h) {
      if (h.level === 2) {
        currentH2 = h;
        currentH3 = null;
        currentGroup = null; // wait until we see a bullet to materialize a group
      } else if (h.level === 3) {
        currentH3 = h;
        currentGroup = openGroup(h);
        if (currentH2) seenH3UnderH2.add(currentH2.line);
      }
      continue;
    }
    // A bullet — attribute it to the current group.
    const bullet = findBulletInLine(li);
    if (!bullet) continue;
    // Only count bullets inside an Experience-flavored section. Without this
    // guard a Skills bulleted list, a "Selected Impact" feature list, or a
    // closing notes section would all be flagged "thin role" / "noisy role".
    if (!isExperienceLikeH2(currentH2)) continue;
    if (currentH3) {
      // Already in an H3 group — append.
      if (!currentGroup || currentGroup.heading !== currentH3) {
        currentGroup = openGroup(currentH3);
      }
      currentGroup.bullets.push(bullet);
    } else if (currentH2) {
      // Bullets directly under H2 (no H3 yet) — group at H2.
      if (!currentGroup || currentGroup.heading !== currentH2) {
        currentGroup = openGroup(currentH2);
      }
      currentGroup.bullets.push(bullet);
    }
  }

  const findings: HealthFinding[] = [];
  for (const g of groups) {
    const count = g.bullets.length;
    // Skip empty groups (a heading with no bullets is a section, not a role).
    if (count === 0) continue;
    if (count > BULLETS_PER_ROLE.max) {
      findings.push({
        id: 'bullets-per-role',
        severity: 'warn',
        message: `${g.heading.title} has ${count} bullets. Aim for 3–5.`,
        line: g.heading.line,
        offender: g.heading.title,
        // Point the user at the sample's Experience section — the canonical
        // shape for 3-5 outcome-led bullets per role.
        suggest: { kind: 'example', section: 'Experience' },
      });
    } else if (count < BULLETS_PER_ROLE.min) {
      findings.push({
        id: 'bullets-per-role',
        severity: 'warn',
        message: `${g.heading.title} has ${count} bullets. Aim for 3–5.`,
        line: g.heading.line,
        offender: g.heading.title,
        suggest: { kind: 'example', section: 'Experience' },
      });
    }
  }
  return findings;
}

/** Return the bullet for a line, or null when the line isn't a bullet. */
function findBulletInLine(li: LineInfo): Bullet | null {
  const m = /^[ \t]*[-*][ \t]+(.*)$/.exec(li.text);
  if (!m) return null;
  return { line: li.line, text: li.text, content: m[1] };
}

/** Escape a literal string for use inside a RegExp. */
function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

/**
 * Per-rule weight multipliers, indexed by stage. Junior is more forgiving on
 * weak verbs (`× 0.5`) because early-career bullets often describe team
 * work; senior is stricter on buzzwords (`× 2`) because a senior resume that
 * leans on "rockstar / leverage / synergy" is signalling something.
 */
const RULE_WEIGHT: Record<CareerStage, Partial<Record<string, number>>> = {
  junior: { 'weak-verb': 0.5 },
  mid: {},
  senior: { buzzwords: 2 },
};

/** Per-finding score delta before stage-weighting and the per-rule cap. */
const SEVERITY_DELTA: Record<HealthSeverity, number> = {
  good: 0,
  warn: -2,
  bad: -10,
};

/** Maximum total points any single rule may subtract from the score. */
const PER_RULE_FLOOR = -20;

/**
 * Compose the score:
 *   1. Start at 100.
 *   2. For each rule with findings, sum its findings' deltas
 *      (`warn` → −2, `bad` → −10), multiply by the stage's per-rule weight,
 *      then cap that rule's contribution at `PER_RULE_FLOOR` (−20).
 *   3. Subtract every rule's capped contribution from 100. Floor at 0.
 *
 * The cap keeps a single noisy rule (e.g. ten weak-verb hits) from
 * dominating the score, while the stage weights bake in the rubric
 * differences without forking the rule code.
 */
function computeScore(findings: HealthFinding[], stage: CareerStage): number {
  const byRule = new Map<string, number>();
  for (const f of findings) {
    const prev = byRule.get(f.id) ?? 0;
    byRule.set(f.id, prev + SEVERITY_DELTA[f.severity]);
  }

  let score = 100;
  for (const [ruleId, raw] of byRule) {
    const weight = RULE_WEIGHT[stage][ruleId] ?? 1;
    const weighted = raw * weight;
    // `weighted` is non-positive; the cap is the more-negative of the two.
    const capped = Math.max(weighted, PER_RULE_FLOOR);
    score += capped;
  }

  return Math.max(0, Math.round(score));
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Analyze a Markdown resume and produce a stage-aware `HealthReport`.
 *
 * Pure: same inputs → same output. Never throws — heuristics that can't run
 * cleanly return zero findings. Safe to call in a `useMemo`.
 */
export function analyzeResume(
  markdown: string,
  parsed: ParsedResume,
  stage: CareerStage,
): HealthReport {
  const findings: HealthFinding[] = [];

  // The rules are listed in the same order as the rubric table so the
  // findings list reads top-to-bottom in a predictable shape.
  findings.push(...checkLength(markdown, stage));
  findings.push(...checkFrontmatter(parsed));
  findings.push(...checkSections(markdown, stage));
  findings.push(...checkQuantification(markdown, stage));
  findings.push(...checkWeakVerbs(markdown));
  findings.push(...checkFirstPerson(markdown));
  findings.push(...checkBuzzwords(markdown));
  findings.push(...checkBulletsPerRole(markdown));

  const score = computeScore(findings, stage);
  return { stage, score, findings };
}

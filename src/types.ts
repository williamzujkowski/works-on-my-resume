/**
 * Shared type contracts for Works on My Resume.
 *
 * This file is the single source of truth for every type that crosses a
 * module boundary. The Markdown pipeline, theme engine, export utilities,
 * and UI components all depend on these definitions — keep them stable.
 */

/* ------------------------------------------------------------------ */
/* Resume content                                                     */
/* ------------------------------------------------------------------ */

/** A labelled hyperlink declared in resume frontmatter. */
export interface ResumeLink {
  label: string;
  url: string;
}

/**
 * Parsed YAML frontmatter from a Markdown resume.
 *
 * MVP intentionally has no rigid schema: known fields are surfaced in the
 * UI when present, and unknown fields are preserved but ignored.
 */
export interface ResumeFrontmatter {
  name?: string;
  role?: string;
  location?: string;
  email?: string;
  phone?: string;
  links?: ResumeLink[];
  [key: string]: unknown;
}

/** Result of parsing + sanitizing a Markdown resume. Output of `markdown.ts`. */
export interface ParsedResume {
  /** Parsed frontmatter, or an empty object when none is present. */
  frontmatter: ResumeFrontmatter;
  /** Markdown body with any frontmatter block stripped. */
  body: string;
  /** Sanitized, render-ready HTML string (safe to inject into the DOM). */
  html: string;
  /** Non-fatal warnings: frontmatter parse errors, sanitizer removals, etc. */
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Raw theme data (shape of src/data/themes.json — themes-slim.json)   */
/* ------------------------------------------------------------------ */

/** The 20 OKLCH color strings present on every slim theme entry. */
export interface RawThemeColors {
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  purple: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightPurple: string;
  brightCyan: string;
  brightWhite: string;
}

/** Precomputed contrast metadata shipped with each slim theme entry. */
export interface RawThemeContrast {
  /** Foreground-on-background contrast ratio (WCAG, 1–21). */
  fgOnBg: number;
  /** Lowest contrast ratio among the ANSI colors against the background. */
  minAnsi: number;
  /** Which ANSI slot produced `minAnsi` (e.g. "red"). */
  minAnsiSlot: string;
}

/** One entry of the vendored `src/data/themes.json` dataset. */
export interface RawTheme {
  name: string;
  slug: string;
  isDark: boolean;
  contrast: RawThemeContrast;
  colors: RawThemeColors;
}

/* ------------------------------------------------------------------ */
/* Normalized resume theme (output of theme engine)                   */
/* ------------------------------------------------------------------ */

/**
 * Semantic resume color tokens. The resume renderer consumes ONLY these —
 * never raw terminal slots — so any theme can drive any layout.
 */
export interface ResumeThemeTokens {
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  accent2: string;
  border: string;
  card: string;
  codeBg: string;
}

/**
 * Per-theme WCAG contrast figures, all measured against the theme's own
 * background. Surfaced so the theme picker can show legibility at a glance
 * and so `resumeSafe` can be derived from real numbers rather than a guess.
 */
export interface ResumeThemeContrast {
  /** Foreground (body text) on background. */
  fgOnBg: number;
  /** Primary accent (`tokens.accent`) on background. */
  accentOnBg: number;
  /** Secondary accent (`tokens.accent2`) on background. */
  accent2OnBg: number;
}

/**
 * The fixed vocabulary of facet tags the theme engine derives from each
 * normalized theme. Drives the picker's tag-chip filter (#87): each chip
 * corresponds to one of these strings, and a theme appears under a chip iff
 * its `tags` array contains that string.
 *
 * Closed set on purpose — the picker UI is keyed to these specific buckets
 * (mode, legibility, palette character), and a free-form taxonomy would
 * neither help the user filter nor stay disjoint from the resume-safe toggle
 * and the search query that compose with it.
 */
export type ResumeThemeTag = 'dark' | 'light' | 'high-contrast' | 'vibrant' | 'muted';
export const RESUME_THEME_TAGS: readonly ResumeThemeTag[] = [
  'dark',
  'light',
  'high-contrast',
  'vibrant',
  'muted',
] as const;

/** A terminal theme normalized into resume-ready semantic tokens. */
export interface ResumeTheme {
  slug: string;
  name: string;
  isDark: boolean;
  tokens: ResumeThemeTokens;
  /**
   * Foreground-on-background contrast ratio (WCAG, 1–21).
   * Retained as the canonical body-text figure; equal to `contrast.fgOnBg`.
   */
  contrastRatio: number;
  /**
   * All measured contrast figures for this theme — body text and both
   * accents — against the theme background. Computed by the theme engine.
   */
  contrast: ResumeThemeContrast;
  /**
   * True when an accent was synthesized (lightness-shifted) to guarantee a
   * legible value because no ANSI slot cleared the accent contrast floor.
   * Purely informational — synthesized accents are still real OKLCH values.
   */
  accentSynthesized: boolean;
  /**
   * True when the theme clears the readable-contrast threshold for body
   * text. Drives the optional "resume-safe themes only" filter.
   *
   * Honest definition: body text must clear `RESUME_SAFE_MIN_CONTRAST`.
   * Accent legibility is no longer a free variable — the theme engine
   * *guarantees* every theme's accents clear `ACCENT_MIN_CONTRAST` (by
   * synthesizing when needed) — so it is intentionally not re-tested here.
   */
  resumeSafe: boolean;
  /**
   * Facet tags derived once during normalization (#87). Composable picker
   * filter: each chip ANDs with the search query and the resume-safe toggle.
   * Always present (may be empty) so callers can rely on `theme.tags.includes`
   * without a guard. The string values are drawn from `ResumeThemeTag`.
   */
  tags: readonly ResumeThemeTag[];
}

/**
 * Maps each semantic token to the CSS custom property the renderer reads.
 * Theme application, theme-CSS export, and the stylesheets must all agree
 * with this mapping.
 */
export const RESUME_CSS_VARS: Record<keyof ResumeThemeTokens, string> = {
  bg: '--resume-bg',
  fg: '--resume-fg',
  muted: '--resume-muted',
  accent: '--resume-accent',
  accent2: '--resume-accent-2',
  border: '--resume-border',
  card: '--resume-card',
  codeBg: '--resume-code-bg',
};

/** Minimum WCAG contrast ratio for a theme to be considered resume-safe. */
export const RESUME_SAFE_MIN_CONTRAST = 7;

/**
 * Minimum WCAG contrast ratio an accent must clear against the theme
 * background. 4.5:1 is the WCAG AA threshold for normal-size text — accents
 * drive headings, links, list markers and bold spans, so they must be at
 * least as legible as body text. The theme engine synthesizes a compliant
 * accent for any theme whose ANSI palette cannot reach this on its own.
 */
export const ACCENT_MIN_CONTRAST = 4.5;

/** Print modes offered by the export workflow. */
export type PrintMode = 'conservative' | 'theme';

/* ------------------------------------------------------------------ */
/* Layout templates (#30)                                              */
/* ------------------------------------------------------------------ */

/**
 * Resume layout templates. Each is a CSS variant on `.resume-preview`,
 * keyed by a `data-template` attribute. All three consume only the
 * existing `--resume-*` semantic tokens — no theme regressions.
 */
export type ResumeTemplate = 'classic' | 'modern' | 'compact';

/** Description for a layout template, used by the layout selector UI. */
export interface ResumeTemplateInfo {
  slug: ResumeTemplate;
  label: string;
  description: string;
}

/** The complete, ordered set of layout templates for the selector UI. */
export const RESUME_TEMPLATES: readonly ResumeTemplateInfo[] = [
  {
    slug: 'classic',
    label: 'Classic',
    description: 'Serif body with the original rhythm.',
  },
  {
    slug: 'modern',
    label: 'Modern',
    description: 'Tighter hierarchy with mono section labels.',
  },
  {
    slug: 'compact',
    label: 'Compact',
    description: 'Dense rhythm tuned for a one-page resume.',
  },
] as const;

/** Default template — the original Source Serif 4 look. */
export const DEFAULT_RESUME_TEMPLATE: ResumeTemplate = 'classic';

/** True when the input string is one of the known template slugs. */
export function isResumeTemplate(value: unknown): value is ResumeTemplate {
  return value === 'classic' || value === 'modern' || value === 'compact';
}

/* ------------------------------------------------------------------ */
/* ATS preview mode (#31)                                              */
/* ------------------------------------------------------------------ */

/**
 * Preview rendering mode.
 *
 *  - `normal`: the active theme and template apply.
 *  - `ats`:    a plain-text-friendly, single-column, color-stripped
 *              rendering meant to approximate what an ATS parser sees.
 *              The theme is intentionally ignored in this mode (the
 *              preview reflects that visibly).
 */
export type PreviewMode = 'normal' | 'ats';

/* ------------------------------------------------------------------ */
/* JSON Resume (#28) — additive type definitions                       */
/* ------------------------------------------------------------------ */

/**
 * A subset of the JSON Resume schema (https://jsonresume.org/schema/) that
 * Works on My Resume can round-trip from Markdown.
 *
 * Every field is OPTIONAL because we both produce and consume JSON Resume
 * documents written by other tools — some omit fields, some carry extras
 * we don't recognize. Unknown top-level keys are preserved in `meta.womr`
 * during a Markdown → JSON Resume conversion, never silently dropped.
 *
 * This is a structural subset, not a wire-format validator. Inputs go
 * through the defensive `fromJsonResume` parser in `utils/jsonresume.ts`,
 * which treats anything malformed as a warning rather than a crash.
 */
export interface JsonResume {
  $schema?: string;
  basics?: JsonResumeBasics;
  work?: JsonResumeWork[];
  education?: JsonResumeEducation[];
  skills?: JsonResumeSkill[];
  /** Free-form additional sections we don't model. Preserved on round-trip. */
  projects?: unknown[];
  awards?: unknown[];
  certificates?: unknown[];
  publications?: unknown[];
  languages?: unknown[];
  interests?: unknown[];
  references?: unknown[];
  volunteer?: unknown[];
  meta?: JsonResumeMeta;
  /** Allow other top-level fields. They survive a round-trip untouched. */
  [key: string]: unknown;
}

export interface JsonResumeBasics {
  name?: string;
  label?: string;
  email?: string;
  phone?: string;
  url?: string;
  summary?: string;
  image?: string;
  location?: JsonResumeLocation;
  profiles?: JsonResumeProfile[];
  [key: string]: unknown;
}

export interface JsonResumeLocation {
  address?: string;
  postalCode?: string;
  city?: string;
  countryCode?: string;
  region?: string;
  [key: string]: unknown;
}

export interface JsonResumeProfile {
  network?: string;
  username?: string;
  url?: string;
  [key: string]: unknown;
}

export interface JsonResumeWork {
  name?: string;
  /** Older schemas used `company` — accept on read, emit `name` on write. */
  company?: string;
  position?: string;
  url?: string;
  startDate?: string;
  endDate?: string;
  summary?: string;
  highlights?: string[];
  location?: string;
  [key: string]: unknown;
}

export interface JsonResumeEducation {
  institution?: string;
  url?: string;
  area?: string;
  studyType?: string;
  startDate?: string;
  endDate?: string;
  score?: string;
  courses?: string[];
  [key: string]: unknown;
}

export interface JsonResumeSkill {
  name?: string;
  level?: string;
  keywords?: string[];
  [key: string]: unknown;
}

export interface JsonResumeMeta {
  canonical?: string;
  version?: string;
  lastModified?: string;
  /** Works on My Resume's namespaced bag for round-trip preservation. */
  womr?: {
    /** Original Markdown body, when a JSON Resume was produced from Markdown. */
    markdownBody?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

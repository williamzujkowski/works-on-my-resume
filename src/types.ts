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

/** A terminal theme normalized into resume-ready semantic tokens. */
export interface ResumeTheme {
  slug: string;
  name: string;
  isDark: boolean;
  tokens: ResumeThemeTokens;
  /** Foreground-on-background contrast ratio (WCAG, 1–21). */
  contrastRatio: number;
  /**
   * True when the theme clears a readable contrast threshold for body text.
   * Drives the optional "resume-safe themes only" filter.
   */
  resumeSafe: boolean;
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

/** Print modes offered by the export workflow. */
export type PrintMode = 'conservative' | 'theme';

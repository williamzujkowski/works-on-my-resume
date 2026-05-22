/**
 * Theme engine for Works on My Resume.
 *
 * Responsibilities:
 *  - Normalize the vendored OKLCH terminal-theme dataset (`RawTheme`) into
 *    resume-ready semantic tokens (`ResumeTheme`).
 *  - Resolve which theme to show on first paint (URL > storage > OS).
 *  - Apply a theme to the live document and serialize it to CSS for export.
 *  - Provide simple search/filter helpers for the theme picker UI.
 *
 * The resume renderer consumes ONLY the eight semantic tokens in
 * `ResumeThemeTokens` — never raw terminal slots — so any of the ~545
 * terminal themes can drive any resume layout.
 *
 * All DOM/browser access is SSR-safe: every `window`/`document`/`localStorage`
 * touch is guarded so this module is import-safe during Astro's build.
 */

import {
  RESUME_CSS_VARS,
  RESUME_SAFE_MIN_CONTRAST,
  type RawTheme,
  type RawThemeColors,
  type ResumeTheme,
  type ResumeThemeTokens,
} from '../types';
import { getStoredThemeSlug } from './storage';

import rawThemesData from '../data/themes.json';

/**
 * The dataset is a ~545-entry literal. A direct `as RawTheme[]` would force
 * TypeScript into a slow deep structural check of the whole literal, so we
 * route through `unknown` — the shape is guaranteed by how it was vendored.
 */
const rawThemes = rawThemesData as unknown as RawTheme[];

/* ------------------------------------------------------------------ */
/* Token normalization                                                 */
/* ------------------------------------------------------------------ */

/**
 * Build a CSS `color-mix()` string in the OKLCH space.
 *
 * Every target browser supports `color-mix()`, so emitting it as a token
 * value yields a valid static CSS value — no JS color math required. The
 * mix is `percent`% of `a` blended into `b`.
 */
function mix(a: string, b: string, percent: number): string {
  return `color-mix(in oklch, ${a} ${percent}%, ${b})`;
}

/**
 * Choose the two accent hues for a theme.
 *
 * We want two vivid, visually distinct hues that read well on the theme's
 * background. Blue is the primary accent in almost every palette; cyan is
 * the natural secondary. We fall back through purple/green so that even
 * monochrome or unusual palettes still yield two *different* accents.
 *
 * For dark themes the brighter ANSI variant is more legible; for light
 * themes the standard (darker) variant carries better contrast on a pale
 * background. We pick accordingly.
 */
function pickAccents(
  colors: RawThemeColors,
  isDark: boolean,
): {
  accent: string;
  accent2: string;
} {
  // Primary candidates, in preference order, paired (standard, bright).
  const primary = isDark ? colors.brightBlue : colors.blue;
  // Secondary candidates in preference order; we take the first that is
  // distinct from the chosen primary.
  const secondaryOrder = isDark
    ? [colors.brightCyan, colors.brightPurple, colors.brightGreen, colors.brightYellow]
    : [colors.cyan, colors.purple, colors.green, colors.yellow];

  const accent = primary;
  const accent2 = secondaryOrder.find((c) => c !== accent) ?? secondaryOrder[0] ?? accent;

  return { accent, accent2 };
}

/**
 * Normalize one raw terminal theme into resume semantic tokens.
 *
 * Token derivation:
 *  - `bg`/`fg`     : taken straight from the terminal background/foreground.
 *  - `accent`/`accent2` : two distinct vivid ANSI hues (see `pickAccents`).
 *  - `muted`       : foreground dimmed toward the background (62% fg).
 *  - `border`      : a very low-contrast divider (22% fg).
 *  - `card`        : a surface lifted slightly off the background — toward
 *                    the foreground for dark themes, also toward fg for
 *                    light themes (a hair darker reads as a raised panel).
 *  - `codeBg`      : a near-background surface, distinct from `card`, with a
 *                    slightly stronger shift so code blocks separate from
 *                    cards visually.
 *
 * Derived tokens are emitted as `color-mix()` strings: valid static CSS.
 */
function normalizeTheme(raw: RawTheme): ResumeTheme {
  const c = raw.colors;
  const { accent, accent2 } = pickAccents(c, raw.isDark);

  const tokens: ResumeThemeTokens = {
    bg: c.background,
    fg: c.foreground,
    // Dimmed foreground — readable but visibly secondary.
    muted: mix(c.foreground, c.background, 62),
    accent,
    accent2,
    // Faint divider line.
    border: mix(c.foreground, c.background, 22),
    // Raised panel: a subtle 6% shift off the background.
    card: mix(c.foreground, c.background, 6),
    // Code surface: distinct from `card` — a stronger 11% shift.
    codeBg: mix(c.foreground, c.background, 11),
  };

  const contrastRatio = raw.contrast.fgOnBg;

  return {
    slug: raw.slug,
    name: raw.name,
    isDark: raw.isDark,
    tokens,
    contrastRatio,
    resumeSafe: contrastRatio >= RESUME_SAFE_MIN_CONTRAST,
  };
}

/* ------------------------------------------------------------------ */
/* Memoized normalized dataset                                          */
/* ------------------------------------------------------------------ */

/** Lazily-computed, normalized-once cache of every theme. */
let normalizedCache: ResumeTheme[] | null = null;

/** Slug → theme index, built alongside `normalizedCache` for O(1) lookups. */
let slugIndex: Map<string, ResumeTheme> | null = null;

function ensureNormalized(): ResumeTheme[] {
  if (normalizedCache && slugIndex) return normalizedCache;
  const normalized = rawThemes.map(normalizeTheme);
  const index = new Map<string, ResumeTheme>();
  for (const theme of normalized) index.set(theme.slug, theme);
  normalizedCache = normalized;
  slugIndex = index;
  return normalized;
}

/* ------------------------------------------------------------------ */
/* Last-resort hardcoded theme                                          */
/* ------------------------------------------------------------------ */

/**
 * An inline, dependency-free theme used only if the dataset is somehow
 * empty. `getFallbackTheme` MUST never throw, so this guarantees a value.
 * Plain neutral light theme — high contrast, resume-safe.
 */
const HARDCODED_FALLBACK: ResumeTheme = {
  slug: 'womr-default',
  name: 'WOMR Default',
  isDark: false,
  tokens: {
    bg: 'oklch(1 0 0)',
    fg: 'oklch(0.25 0 0)',
    muted: 'oklch(0.5 0 0)',
    accent: 'oklch(0.5 0.18 260)',
    accent2: 'oklch(0.55 0.12 200)',
    border: 'oklch(0.85 0 0)',
    card: 'oklch(0.98 0 0)',
    codeBg: 'oklch(0.95 0 0)',
  },
  // WCAG ratio of oklch(0.25 0 0) on white is comfortably above the
  // resume-safe threshold; hardcoded so it never depends on the dataset.
  contrastRatio: 12,
  resumeSafe: true,
};

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Every theme, normalized into resume tokens. Computed once, then cached. */
export function getAllThemes(): ResumeTheme[] {
  return ensureNormalized();
}

/** Look up a single theme by slug. `undefined` when no such slug exists. */
export function findTheme(slug: string): ResumeTheme | undefined {
  ensureNormalized();
  return slugIndex?.get(slug);
}

/**
 * Return a known-good, high-contrast, resume-safe theme of the requested
 * mode. Never throws — degrades through several layers:
 *
 *   1. A recognizable preferred slug (`github` for light, `tokyonight` for
 *      dark) — but only if it exists in the dataset.
 *   2. The first `resumeSafe` theme of the requested mode.
 *   3. The first theme of the requested mode, regardless of safety.
 *   4. The first theme in the dataset, regardless of mode.
 *   5. The inline `HARDCODED_FALLBACK` (only if the dataset is empty).
 *
 * @param prefersDark When true, return a dark theme; otherwise a light one.
 */
export function getFallbackTheme(prefersDark = false): ResumeTheme {
  const themes = ensureNormalized();

  // 1. Recognizable preferred slug for the requested mode.
  const preferredSlug = prefersDark ? 'tokyonight' : 'github';
  const preferred = slugIndex?.get(preferredSlug);
  if (preferred && preferred.isDark === prefersDark) return preferred;

  // 2. First resume-safe theme of the requested mode.
  const safeOfMode = themes.find((t) => t.isDark === prefersDark && t.resumeSafe);
  if (safeOfMode) return safeOfMode;

  // 3. Any theme of the requested mode.
  const anyOfMode = themes.find((t) => t.isDark === prefersDark);
  if (anyOfMode) return anyOfMode;

  // 4. Any theme at all.
  if (themes.length > 0) return themes[0];

  // 5. Absolute last resort — the dataset is empty.
  return HARDCODED_FALLBACK;
}

/**
 * Decide which theme slug to use on first paint.
 *
 * Priority order:
 *   1. `?theme=<slug>` URL parameter — but only if that slug exists.
 *   2. The slug persisted in `localStorage` — but only if it still exists.
 *   3. The OS `prefers-color-scheme` → the matching fallback theme's slug.
 *
 * SSR-safe: every `window` access is guarded, so during Astro's build this
 * resolves purely against the dataset's light fallback.
 */
export function resolveInitialThemeSlug(): string {
  ensureNormalized();

  // 1. URL parameter.
  if (typeof window !== 'undefined' && window.location?.search) {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlSlug = params.get('theme');
      if (urlSlug && slugIndex?.has(urlSlug)) return urlSlug;
    } catch {
      /* malformed query string — ignore and continue */
    }
  }

  // 2. Stored preference.
  const stored = getStoredThemeSlug();
  if (stored && slugIndex?.has(stored)) return stored;

  // 3. OS color-scheme preference.
  let prefersDark = false;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      /* matchMedia unsupported — keep the light default */
    }
  }
  return getFallbackTheme(prefersDark).slug;
}

/**
 * Apply a theme to the live document.
 *
 * Sets every `--resume-*` custom property on `<html>` and records the mode
 * in `data-resume-mode` ('dark' | 'light') so CSS can branch on it.
 * SSR-safe no-op when there is no `document`.
 */
export function applyThemeToDocument(theme: ResumeTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const { style } = root;

  // `key` is a keyof ResumeThemeTokens, so both lookups are type-safe.
  (Object.keys(RESUME_CSS_VARS) as (keyof ResumeThemeTokens)[]).forEach((key) => {
    style.setProperty(RESUME_CSS_VARS[key], theme.tokens[key]);
  });

  root.dataset.resumeMode = theme.isDark ? 'dark' : 'light';
}

/**
 * Serialize a theme to a standalone CSS `:root { ... }` rule.
 *
 * Used by the export pipeline to bake the active theme into exported HTML
 * without any runtime JavaScript.
 */
export function themeCssVariables(theme: ResumeTheme): string {
  const lines = (Object.keys(RESUME_CSS_VARS) as (keyof ResumeThemeTokens)[])
    .map((key) => `  ${RESUME_CSS_VARS[key]}: ${theme.tokens[key]};`)
    .join('\n');
  return `:root {\n${lines}\n}\n`;
}

/**
 * Filter a list of themes by a free-text query.
 *
 * Case-insensitive substring match against both `name` and `slug`. An empty
 * (or whitespace-only) query matches everything. When `resumeSafeOnly` is
 * true, non-resume-safe themes are dropped regardless of the query.
 */
export function filterThemes(
  themes: ResumeTheme[],
  query: string,
  resumeSafeOnly = false,
): ResumeTheme[] {
  const needle = query.trim().toLowerCase();
  return themes.filter((theme) => {
    if (resumeSafeOnly && !theme.resumeSafe) return false;
    if (needle.length === 0) return true;
    return theme.name.toLowerCase().includes(needle) || theme.slug.toLowerCase().includes(needle);
  });
}

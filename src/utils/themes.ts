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
 * `ResumeThemeTokens` — never raw terminal slots — so any of the ~465
 * terminal themes can drive any resume layout.
 *
 * All DOM/browser access is SSR-safe: every `window`/`document`/`localStorage`
 * touch is guarded so this module is import-safe during Astro's build.
 */

import {
  ACCENT_MIN_CONTRAST,
  RESUME_CSS_VARS,
  RESUME_SAFE_MIN_CONTRAST,
  type RawTheme,
  type RawThemeColors,
  type ResumeTheme,
  type ResumeThemeContrast,
  type ResumeThemeTag,
  type ResumeThemeTokens,
} from '../types';
import { getStoredThemeSlug } from './storage';

/* ------------------------------------------------------------------ *
 * Code-split dataset (#78)                                            *
 *                                                                     *
 * `src/data/themes.json` is ~600 kB raw (the largest single asset in  *
 * the bundle). Statically importing it forced Vite to inline it into  *
 * the main client chunk, blowing past the 500 kB warning threshold    *
 * even though the dataset is only needed AFTER the user opens the     *
 * theme picker. We now load it lazily via a dynamic `import()` so     *
 * Vite emits it as its own chunk, fetched on demand.                  *
 *                                                                     *
 * Loading lifecycle:                                                  *
 *   1. App boots with no themes loaded; `getAllThemes()` returns just *
 *      the inline `HARDCODED_FALLBACK` so any sync caller still gets  *
 *      a legible value.                                               *
 *   2. `loadAllThemesAsync()` (called by `ResumeStudio` on mount)     *
 *      fetches the JSON chunk, normalizes every entry through the     *
 *      same OKLCH math + accent-synthesis + surface-derivation        *
 *      pipeline used by the sync path, and populates the cache.       *
 *   3. Subsequent sync calls (`getAllThemes`, `findTheme`,            *
 *      `getFallbackTheme`, `resolveInitialThemeSlug`) transparently   *
 *      see the full dataset.                                          *
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* WCAG contrast math (OKLCH → linear sRGB → relative luminance)        */
/* ------------------------------------------------------------------ */
/*
 * The dataset ships every color as an `oklch(L C H)` string and a
 * precomputed `contrast.fgOnBg`/`minAnsi` — but NOT accent contrast. To
 * guarantee legible accents (#48) and an honest `resumeSafe` (#47) we need
 * to measure contrast ourselves, so this module carries a small, exact
 * OKLCH→WCAG pipeline:
 *
 *   oklch(L C H)  →  OKLab(L a b)  →  linear sRGB  →  relative luminance
 *
 * Relative luminance feeds the WCAG 2.x contrast formula. The math is the
 * standard Björn Ottosson OKLab matrices; validated against the dataset's
 * own `fgOnBg` figures (agreement within ~0.04 across all 465 themes).
 */

/** A parsed OKLCH color: L in [0,1], C ≥ 0, H in degrees. */
interface Oklch {
  L: number;
  C: number;
  H: number;
}

/**
 * Parse an `oklch(L C H)` string into numeric components.
 *
 * Tolerates the few syntactic forms the dataset and synthesis can produce:
 * percentage lightness (`60%`), percentage chroma (relative to the 0.4
 * reference per the CSS spec), optional alpha and `/`, and signed hue.
 * Returns `null` for anything that is not a recognizable OKLCH string so
 * callers can degrade gracefully rather than throw.
 */
function parseOklch(input: string): Oklch | null {
  const m = /oklch\(\s*([0-9.]+%?)\s+([0-9.]+%?)\s+([-0-9.]+)/i.exec(input);
  if (!m) return null;

  let L = parseFloat(m[1]);
  if (m[1].includes('%')) L /= 100;

  let C = parseFloat(m[2]);
  // Per CSS Color 4, a percentage chroma is relative to a reference of 0.4.
  if (m[2].includes('%')) C = (C / 100) * 0.4;

  const H = parseFloat(m[3]);
  if (!Number.isFinite(L) || !Number.isFinite(C) || !Number.isFinite(H)) return null;
  return { L, C, H };
}

/** Serialize numeric OKLCH components back into a CSS `oklch(...)` string. */
function formatOklch({ L, C, H }: Oklch): string {
  // Three decimals is plenty of precision for an 8-bit-ish display target
  // and keeps the emitted CSS compact.
  const r = (n: number) => Number(n.toFixed(3));
  return `oklch(${r(L)} ${r(C)} ${r(((H % 360) + 360) % 360)})`;
}

/**
 * Convert OKLCH components to linear-light sRGB (channels may fall outside
 * [0,1] when the color is out of the sRGB gamut — callers clamp).
 *
 * OKLCH → OKLab (polar→cartesian) → LMS' → LMS → linear sRGB, using the
 * standard OKLab matrices.
 */
function oklchToLinearSrgb({ L, C, H }: Oklch): [number, number, number] {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  // OKLab → non-linear LMS.
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  // Cube to linear LMS.
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  // LMS → linear sRGB.
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/**
 * WCAG relative luminance of a parsed OKLCH color.
 *
 * Linear sRGB is already the linear-light space WCAG's luminance formula
 * expects, so we clamp out-of-gamut channels into [0,1] and apply the
 * Rec.709 coefficients directly — no extra gamma step needed.
 */
function relativeLuminanceOf(color: Oklch): number {
  const [r, g, b] = oklchToLinearSrgb(color);
  const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
}

/** WCAG contrast ratio (1–21) between two relative-luminance values. */
function contrastFromLuminance(lumA: number, lumB: number): number {
  const hi = Math.max(lumA, lumB);
  const lo = Math.min(lumA, lumB);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * WCAG contrast ratio (1–21) between two `oklch(...)` color strings.
 *
 * Returns `1` (no contrast) if either string fails to parse — a safe,
 * non-throwing degradation that simply makes an unparseable color look
 * "unsafe" rather than crashing theme normalization.
 */
export function contrastRatio(colorA: string, colorB: string): number {
  const a = parseOklch(colorA);
  const b = parseOklch(colorB);
  if (!a || !b) return 1;
  return contrastFromLuminance(relativeLuminanceOf(a), relativeLuminanceOf(b));
}

/* ------------------------------------------------------------------ */
/* Accent selection & synthesis (#48)                                   */
/* ------------------------------------------------------------------ */

/**
 * Minimum chroma for a color to count as a real "hue" rather than a gray.
 * Near-monochrome themes whose blue slot is effectively gray would yield an
 * accent indistinguishable from body text — those get synthesized instead.
 */
const ACCENT_MIN_CHROMA = 0.05;

/** Upper bound on synthesized chroma — keeps accents from looking neon. */
const ACCENT_MAX_CHROMA = 0.32;

/**
 * Highest WCAG contrast a hue can reach on `bgLum` at a fixed chroma.
 *
 * Pushing lightness to either extreme (0 or 1) maximizes the luminance gap;
 * whichever extreme wins tells us both the ceiling and the direction the
 * binary search should travel.
 */
function maxContrastAtChroma(color: Oklch, chroma: number, bgLum: number): number {
  const dark = relativeLuminanceOf({ ...color, C: chroma, L: 0 });
  const light = relativeLuminanceOf({ ...color, C: chroma, L: 1 });
  return Math.max(contrastFromLuminance(dark, bgLum), contrastFromLuminance(light, bgLum));
}

/**
 * Synthesize a legible accent from a base hue.
 *
 * Strategy:
 *  1. Preserve the base hue and chroma. If even pure black/white at that
 *     chroma cannot reach `target` on this background (a mid-luminance bg,
 *     or a very saturated hue that gamut-clips), progressively damp the
 *     chroma toward neutral until the target becomes reachable. A
 *     high-contrast near-neutral is an acceptable accent per #48.
 *  2. Binary-search OKLCH lightness toward the background — i.e. pick the
 *     *least* extreme lightness that still clears `target` — so the accent
 *     stays as close to the palette's intent as legibility allows.
 *
 * Always returns a color that clears `target` (the search starts from an
 * extreme that is guaranteed to satisfy it once chroma has been damped).
 * The search aims a hair *above* `target` so the value still clears it
 * after `formatOklch` rounds lightness to three decimals.
 */
function synthesizeAccent(base: Oklch, bgLum: number, target: number): Oklch {
  let chroma = Math.min(Math.max(base.C, ACCENT_MIN_CHROMA), ACCENT_MAX_CHROMA);

  // Aim slightly above `target` so three-decimal rounding cannot push the
  // emitted color back under the threshold.
  const goal = target + 0.05;

  // 1. Damp chroma until `goal` is physically reachable at some lightness.
  for (let i = 0; i < 24 && maxContrastAtChroma(base, chroma, bgLum) < goal; i += 1) {
    chroma *= 0.8;
  }

  // Travel toward whichever extreme yields more contrast on this background.
  const lighterWins =
    contrastFromLuminance(relativeLuminanceOf({ ...base, C: chroma, L: 1 }), bgLum) >=
    contrastFromLuminance(relativeLuminanceOf({ ...base, C: chroma, L: 0 }), bgLum);

  // 2. Binary-search the least-extreme lightness that still clears `goal`.
  let lo = 0;
  let hi = 1;
  let best: Oklch = { ...base, C: chroma, L: lighterWins ? 1 : 0 };
  for (let i = 0; i < 28; i += 1) {
    const mid = (lo + hi) / 2;
    const candidate: Oklch = { ...base, C: chroma, L: mid };
    const ok = contrastFromLuminance(relativeLuminanceOf(candidate), bgLum) >= goal;
    if (ok) {
      best = candidate;
      // Keep the compliant value, move the search toward the background.
      if (lighterWins) hi = mid;
      else lo = mid;
    } else if (lighterWins) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}

/** An accent candidate: its color, contrast on bg, and a ranking score. */
interface AccentCandidate {
  color: string;
  parsed: Oklch;
  contrast: number;
  score: number;
}

/**
 * Choose two legible, mutually-distinct accent colors for a theme (#48).
 *
 * `accent`/`accent2` drive every heading, link, list marker and bold span,
 * so both MUST be readable on the background and visibly different from
 * each other and from the body foreground. The old implementation blindly
 * took ANSI blue/cyan, leaving 42 themes with sub-3:1 headings and dozens
 * more with a gray "accent" indistinguishable from text.
 *
 * Algorithm:
 *  1. Score every chromatic ANSI slot by contrast-on-bg (capped, so a
 *     merely-legible vivid hue is not beaten by an over-bright pale one)
 *     plus a chroma bonus (vividness reads as "accent").
 *  2. Keep only candidates that clear `ACCENT_MIN_CONTRAST` AND
 *     `ACCENT_MIN_CHROMA` and are distinct from the foreground.
 *  3. If two such candidates exist, take the two highest-scoring that are
 *     also hue-distinct from each other.
 *  4. Otherwise synthesize: pick the highest-chroma ANSI slot(s) as base
 *     hues and lightness-shift them until they clear the floor. The second
 *     accent is offset ~150° in hue so the pair stays distinguishable even
 *     for near-monochrome palettes.
 *
 * `synthesized` is true whenever step 4 ran.
 */
function pickAccents(
  colors: RawThemeColors,
  foreground: string,
): {
  accent: string;
  accent2: string;
  synthesized: boolean;
} {
  const bg = parseOklch(colors.background);
  const fg = parseOklch(colors.foreground);
  const bgLum = bg ? relativeLuminanceOf(bg) : 1;

  // The chromatic ANSI slots, in rough preference order (blue-family first
  // — it is the conventional resume accent — then the rest).
  const slotNames: (keyof RawThemeColors)[] = [
    'blue',
    'cyan',
    'purple',
    'green',
    'red',
    'yellow',
    'brightBlue',
    'brightCyan',
    'brightPurple',
    'brightGreen',
    'brightRed',
    'brightYellow',
  ];

  // Two hues are "distinct" if their OKLCH hue angles differ by ≥ this many
  // degrees (measured as the shorter way around the wheel).
  const HUE_DISTINCT = 25;
  const hueGap = (a: number, b: number): number => {
    const d = Math.abs(((a - b + 540) % 360) - 180);
    return d;
  };

  const candidates: AccentCandidate[] = [];
  for (const name of slotNames) {
    const value = colors[name];
    const parsed = parseOklch(value);
    if (!parsed) continue;
    const ratio = contrastRatio(value, colors.background);
    // Cap the contrast term at the resume-safe ceiling: beyond that, extra
    // contrast no longer matters and we would rather reward chroma.
    const score = Math.min(ratio, RESUME_SAFE_MIN_CONTRAST) + parsed.C * 3;
    candidates.push({ color: value, parsed, contrast: ratio, score });
  }

  // Legible, vivid, and not a near-clone of the body foreground.
  const usable = candidates
    .filter(
      (c) =>
        c.contrast >= ACCENT_MIN_CONTRAST &&
        c.parsed.C >= ACCENT_MIN_CHROMA &&
        c.color !== foreground,
    )
    .sort((a, b) => b.score - a.score);

  if (usable.length >= 1) {
    const accent = usable[0];
    // Second accent: best-scoring candidate that is hue-distinct from the
    // first (falls through to any other usable one, then to synthesis).
    const accent2 = usable
      .slice(1)
      .find((c) => hueGap(c.parsed.H, accent.parsed.H) >= HUE_DISTINCT);

    if (accent2) {
      return { accent: accent.color, accent2: accent2.color, synthesized: false };
    }

    // Only one legible-and-distinct hue exists — keep it as `accent` and
    // synthesize a hue-offset partner so the pair is still distinguishable.
    const offsetHue = (accent.parsed.H + 150) % 360;
    const synthBase: Oklch = {
      L: accent.parsed.L,
      C: Math.max(accent.parsed.C, ACCENT_MIN_CHROMA),
      H: offsetHue,
    };
    return {
      accent: accent.color,
      accent2: formatOklch(synthesizeAccent(synthBase, bgLum, ACCENT_MIN_CONTRAST)),
      synthesized: true,
    };
  }

  // No usable ANSI accent at all — synthesize both. Use the two
  // highest-chroma slots as hue seeds so synthesized accents still echo the
  // palette's character; force them ~150° apart for visible separation.
  const byChroma = candidates.slice().sort((a, b) => b.parsed.C - a.parsed.C);
  const seed1 = byChroma[0]?.parsed ?? fg ?? { L: 0.5, C: 0.15, H: 260 };
  const seed2Raw = byChroma.find((c) => hueGap(c.parsed.H, seed1.H) >= HUE_DISTINCT)?.parsed;

  const base1: Oklch = { L: seed1.L, C: Math.max(seed1.C, ACCENT_MIN_CHROMA), H: seed1.H };
  const base2: Oklch = {
    L: (seed2Raw ?? seed1).L,
    C: Math.max((seed2Raw ?? seed1).C, ACCENT_MIN_CHROMA),
    // If no naturally-distinct hue exists, manufacture one 150° away.
    H: seed2Raw ? seed2Raw.H : (seed1.H + 150) % 360,
  };

  return {
    accent: formatOklch(synthesizeAccent(base1, bgLum, ACCENT_MIN_CONTRAST)),
    accent2: formatOklch(synthesizeAccent(base2, bgLum, ACCENT_MIN_CONTRAST)),
    synthesized: true,
  };
}

/* ------------------------------------------------------------------ */
/* Surface-token derivation (#59)                                       */
/* ------------------------------------------------------------------ */
/*
 * `muted`, `border`, `card` and `codeBg` are *derived* surfaces — the
 * dataset never ships them. They used to be emitted as `color-mix()`
 * strings that always blended toward `fg`, which was mode-blind (a "raised"
 * card went *darker* on light themes, the opposite of what a raised panel
 * should do) and broke standalone-HTML exports on renderers without
 * `color-mix()` support.
 *
 * The pipeline below computes each as a concrete `oklch(...)` value via the
 * existing OKLCH parse/format helpers, so:
 *   - exports are engine-independent (no `color-mix()` in token output), and
 *   - derivation is mode-aware: light themes lift surfaces toward white,
 *     dark themes lift them toward `fg`, and the lift is scaled by the
 *     actual `fg`/`bg` luminance gap so surfaces stay visible on both
 *     extreme (very high-contrast) and low-contrast palettes.
 */

/**
 * Linearly interpolate two OKLCH colors in OKLCH space.
 *
 * `t` is the fraction of `b` blended into `a` (t = 0 → `a`, t = 1 → `b`).
 * Hue is interpolated the short way around the wheel so a blend between,
 * say, 350° and 10° passes through 0° rather than sweeping 340°.
 */
function lerpOklch(a: Oklch, b: Oklch, t: number): Oklch {
  // Shortest-path hue interpolation.
  const dH = ((b.H - a.H + 540) % 360) - 180;
  return {
    L: a.L + (b.L - a.L) * t,
    C: a.C + (b.C - a.C) * t,
    H: a.H + dH * t,
  };
}

/** Clamp a number into the inclusive [lo, hi] range. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * The four derived surface tokens for one theme, each a concrete OKLCH
 * color string (never a `color-mix()` expression).
 */
interface SurfaceTokens {
  muted: string;
  border: string;
  card: string;
  codeBg: string;
}

/**
 * Smallest OKLCH-lightness separation that still reads as a visible edge.
 * `border`/`card`/`codeBg` each enforce a floor at least this large so a
 * surface never silently collapses into the color it sits on.
 */
const MIN_SURFACE_L_DELTA = 0.045;

/**
 * Derive the four surface tokens from a theme's `bg`/`fg`.
 *
 * All four are placed by *lightness* in OKLCH, keeping the background's hue
 * and chroma so surfaces feel native to the palette:
 *
 *  - `card` / `codeBg` are "raised" surfaces, placed by an *absolute*
 *    OKLCH-lightness step from `bg`:
 *      · light theme → step toward white (lighter reads as raised);
 *      · dark theme  → step toward `fg`  (lighter — `fg` is the light end).
 *    If the preferred direction has no headroom (a pure-white light bg, or
 *    a pure-black dark bg) the step *flips* — a tiny move the other way is
 *    far better than a surface that silently collides with `bg`. This is
 *    why GitHub-light's white bg yields a subtly *darker* card, exactly
 *    like GitHub's own `#f6f8fa` panel.
 *  - The step is scaled by `gap`, the |fg − bg| OKLCH-lightness span. A
 *    near-monochrome / low-contrast palette has a small gap and gets a
 *    gentle step; a high-contrast palette has a large gap and tolerates a
 *    slightly bigger one. Either way the step is clamped small — these are
 *    backgrounds, not loud panels.
 *  - `border` is a divider: a lightness step from `bg` toward `fg`, but
 *    floored at `MIN_SURFACE_L_DELTA` so it is never invisible.
 *  - `codeBg` is forced distinct from both `card` and `bg` so code blocks
 *    read as their own surface.
 *  - `muted` is secondary *text*, so it is contrast-driven: dimmed from
 *    `fg` toward `bg`, then pulled back if it drops below a legibility
 *    floor (aiming for WCAG AA where the palette allows).
 *
 * @param bgStr  Theme background (`oklch(...)` string).
 * @param fgStr  Theme foreground (`oklch(...)` string).
 * @param isDark The theme's own light/dark classification.
 */
function deriveSurfaces(bgStr: string, fgStr: string, isDark: boolean): SurfaceTokens {
  const bg = parseOklch(bgStr);
  const fg = parseOklch(fgStr);

  // Defensive fallback: if either color is unparseable, hand back the raw
  // strings rather than throwing — normalization must never crash.
  if (!bg || !fg) {
    return { muted: fgStr, border: fgStr, card: bgStr, codeBg: bgStr };
  }

  // The OKLCH-lightness gap between text and background. Drives how far
  // surfaces may travel: small gap (low-contrast palette) → gentle lifts;
  // large gap (extreme palette) → room for stronger, still-subtle lifts.
  const gap = Math.abs(fg.L - bg.L);

  /* --- card / codeBg : raised surfaces ----------------------------- */
  //
  // A raised surface reads correctly as a step toward MORE lightness:
  // toward white on a light theme, toward `fg` on a dark one. We express
  // that as an absolute lightness delta plus a direction.
  //
  // `liftSign` is +1 — a raised surface goes *lighter* in both modes
  // (toward white for light themes, toward `fg`, the light end, for dark
  // ones). It FLIPS to -1 when that direction has no headroom: a
  // pure-white light bg (L = 1) cannot go lighter, so its card/code
  // surfaces step slightly darker instead; a pure-black dark bg (L = 0)
  // flips the other way. Flipping beats colliding with `bg`.
  let liftSign = 1;
  // Mode-aware magnitude: dark surfaces compress perceptually — a step
  // near L = 0 looks smaller than the same step near L = 1 — so dark
  // themes get a slightly larger lift to keep the surface visible.
  const modeBoost = isDark ? 1.35 : 1;
  // Absolute lightness deltas, scaled by the contrast gap and the mode
  // boost, then clamped so surfaces stay subtle. `card` is a faint step;
  // `codeBg` a bit further.
  const cardStep = clamp((0.05 + gap * 0.05) * modeBoost, MIN_SURFACE_L_DELTA, 0.12);
  const codeStep = clamp((0.1 + gap * 0.09) * modeBoost, 0.09, 0.22);
  // If a full code-surface step would run off the top (or bottom) of the
  // lightness range, flip both surfaces toward the side that has room.
  if (bg.L + liftSign * codeStep > 1 || bg.L + liftSign * codeStep < 0) {
    liftSign = -liftSign;
  }

  // `card`/`codeBg` keep the background's hue and a damped slice of its
  // chroma so the surface feels native to a tinted palette without picking
  // up a visible color cast.
  const surfaceChroma = clamp(bg.C * 0.85, 0, 0.05);
  let card: Oklch = {
    L: clamp(bg.L + liftSign * cardStep, 0, 1),
    C: surfaceChroma,
    H: bg.H,
  };
  let codeBg: Oklch = {
    L: clamp(bg.L + liftSign * codeStep, 0, 1),
    C: surfaceChroma,
    H: bg.H,
  };

  // Guarantee `card` is a perceptible step off `bg` (clamping above may
  // have eaten the step on an extreme palette).
  if (Math.abs(card.L - bg.L) < MIN_SURFACE_L_DELTA) {
    card = { ...card, L: clamp(bg.L + liftSign * MIN_SURFACE_L_DELTA, 0, 1) };
  }

  // Guarantee `codeBg` is distinct from BOTH `card` and `bg` — code blocks
  // should never visually merge into either. It sits a further step past
  // `card`, in the same direction, re-clamped into range.
  if (Math.abs(codeBg.L - card.L) < MIN_SURFACE_L_DELTA) {
    codeBg = { ...codeBg, L: clamp(card.L + liftSign * MIN_SURFACE_L_DELTA, 0, 1) };
  }
  if (Math.abs(codeBg.L - bg.L) < MIN_SURFACE_L_DELTA) {
    codeBg = { ...codeBg, L: clamp(bg.L + liftSign * 2 * MIN_SURFACE_L_DELTA, 0, 1) };
  }

  /* --- border : a perceptible divider ------------------------------ */
  //
  // A divider steps from `bg` toward `fg` (a border reads best as a faint
  // echo of the text color). The step is scaled by `gap`, then floored so
  // it is always visible even on a flat palette.
  const borderDir = fg.L >= bg.L ? 1 : -1;
  let borderDelta = Math.max(MIN_SURFACE_L_DELTA + gap * 0.14, MIN_SURFACE_L_DELTA);
  // Never let the divider out-shout `card`/`codeBg`: keep it a *faint* line.
  borderDelta = Math.min(borderDelta, 0.22);
  const border: Oklch = {
    L: clamp(bg.L + borderDir * borderDelta, 0, 1),
    // A touch of the background's chroma keeps the line from looking like a
    // foreign gray on a tinted theme; the fg blend keeps it neutral-ish.
    C: clamp(bg.C * 0.6 + fg.C * 0.15, 0, 0.1),
    H: bg.H,
  };

  /* --- muted : legible secondary text ------------------------------ */
  //
  // `muted` is *text*, not a surface, so it is contrast-driven. Start by
  // dimming `fg` toward `bg` (62% of the way to fg from bg, matching the
  // previous visual weight), then, if that drops below a legibility floor,
  // pull it back toward `fg` until it clears the floor (or `fg` itself if
  // the palette simply cannot reach it).
  const MUTED_TARGET_CONTRAST = 4.5; // WCAG AA for normal text.
  const MUTED_FLOOR_CONTRAST = 3.0; // Absolute minimum — never below this.
  const bgLum = relativeLuminanceOf(bg);

  let mutedT = 0.62; // Fraction from `bg` toward `fg`.
  let muted = lerpOklch(bg, fg, mutedT);

  // Walk `muted` toward `fg` until it is comfortably legible. Each step
  // closes 18% of the remaining distance; capped iterations guarantee
  // termination. We aim for AA, but accept anything ≥ the hard floor — a
  // low-contrast palette physically cannot do better and we must not
  // collapse `muted` into `bg`.
  for (let i = 0; i < 24; i += 1) {
    const ratio = contrastFromLuminance(relativeLuminanceOf(muted), bgLum);
    if (ratio >= MUTED_TARGET_CONTRAST) break;
    mutedT += (1 - mutedT) * 0.18;
    muted = lerpOklch(bg, fg, mutedT);
  }
  // Final safety net: if even that did not clear the hard floor, fall all
  // the way back to `fg` (guaranteed to be the most legible value there is).
  if (contrastFromLuminance(relativeLuminanceOf(muted), bgLum) < MUTED_FLOOR_CONTRAST) {
    muted = { ...fg };
  }

  return {
    muted: formatOklch(muted),
    border: formatOklch(border),
    card: formatOklch(card),
    codeBg: formatOklch(codeBg),
  };
}

/* ------------------------------------------------------------------ */
/* Facet-tag derivation (#87)                                          */
/* ------------------------------------------------------------------ */
/*
 * Every normalized theme carries a small, closed-vocabulary `tags` array
 * (`ResumeThemeTag`). The picker exposes these as composable chips above
 * its search row: `dark`, `light`, `high-contrast`, `vibrant`, `muted`.
 *
 * Each tag is derived purely from data already on the `RawTheme` so we
 * never duplicate hand-curated metadata for ~465 themes:
 *
 *  - `dark` / `light` mirror `RawTheme.isDark`.
 *  - `high-contrast` fires when body text clears 10:1 on the background —
 *    a clear WCAG AAA-and-then-some bar that selects the legible end of the
 *    spectrum without overlapping `resume-safe` (which is the 7:1 toggle).
 *  - `vibrant` / `muted` look at the *average* chroma of the eight ANSI
 *    slots, the values that actually drive accent selection. Thresholds
 *    were tuned against the live dataset (see comment below) so the buckets
 *    are useful filters rather than near-universal or near-empty labels.
 *
 * Computed once during `normalizeTheme` and frozen onto the resulting
 * `ResumeTheme`; the picker just runs `theme.tags.includes(tag)`.
 */

/** The eight chromatic ANSI slots that drive accent selection. */
const ANSI_HUE_SLOTS: readonly (keyof RawThemeColors)[] = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'purple',
  'cyan',
  'white',
];

/**
 * WCAG ratio at which body text is considered comfortably legible — well
 * beyond `RESUME_SAFE_MIN_CONTRAST` (7:1). Chosen so the chip is meaningful
 * even after the resume-safe toggle is on: most resume-safe themes are not
 * also high-contrast, so the chip narrows the list further.
 */
const HIGH_CONTRAST_MIN = 10;

/**
 * Average-ANSI-chroma cutoffs for the palette-character chips. Tuned
 * against the vendored dataset (#87 spec) so the buckets are useful filters
 * rather than near-universal or near-empty labels:
 *
 *  - `vibrant >= 0.12`  →  ≈34% of themes qualify (target band 25–35%).
 *    Catches `dracula`, `github-light-default`, `github-dark-default` and
 *    leaves merely-saturated palettes (`tokyonight` @ 0.106, `catppuccin-
 *    mocha` @ 0.081) out, which matches how they read on screen.
 *  - `muted   <  0.04`  →  ≈3% of themes qualify, deliberately a niche bucket
 *    for near-monochrome palettes (`black-metal-bathory`, the various
 *    grayscale "paper" themes). Disjoint from `vibrant` by construction.
 */
const VIBRANT_AVG_CHROMA_MIN = 0.12;
const MUTED_AVG_CHROMA_MAX = 0.04;

/**
 * Mean OKLCH chroma across the eight ANSI hue slots. Slots that fail to
 * parse contribute zero (and lower the mean) — a deliberate, conservative
 * choice: an unparseable slot is closer to "no color" than to "very vivid".
 */
function averageAnsiChroma(colors: RawThemeColors): number {
  let sum = 0;
  for (const slot of ANSI_HUE_SLOTS) {
    const parsed = parseOklch(colors[slot]);
    if (parsed) sum += parsed.C;
  }
  return sum / ANSI_HUE_SLOTS.length;
}

/**
 * Derive the picker's facet-tag array from a raw theme.
 *
 * Cheap (one parse per ANSI slot) and pure — fine to call once per theme at
 * normalization time. Returned as a `readonly` so callers cannot mutate the
 * canonical theme record.
 */
function deriveTags(raw: RawTheme): readonly ResumeThemeTag[] {
  const tags: ResumeThemeTag[] = [];
  tags.push(raw.isDark ? 'dark' : 'light');
  if (raw.contrast.fgOnBg >= HIGH_CONTRAST_MIN) tags.push('high-contrast');
  const avgChroma = averageAnsiChroma(raw.colors);
  if (avgChroma >= VIBRANT_AVG_CHROMA_MIN) tags.push('vibrant');
  else if (avgChroma < MUTED_AVG_CHROMA_MAX) tags.push('muted');
  return Object.freeze(tags);
}

/**
 * Normalize one raw terminal theme into resume semantic tokens.
 *
 * Token derivation:
 *  - `bg`/`fg`     : taken straight from the terminal background/foreground.
 *  - `accent`/`accent2` : two distinct vivid ANSI hues (see `pickAccents`).
 *  - `muted`/`border`/`card`/`codeBg` : derived surfaces — see
 *    `deriveSurfaces`. Each is a concrete `oklch(...)` value (no
 *    `color-mix()`), mode-aware, and scaled by the palette's contrast.
 *
 * Every derived token is emitted as a literal `oklch(...)` string, so the
 * standalone-HTML export is engine-independent — no `color-mix()` support
 * required by the consuming renderer / PDF engine.
 */
function normalizeTheme(raw: RawTheme): ResumeTheme {
  const c = raw.colors;
  // `pickAccents` guarantees both accents clear `ACCENT_MIN_CONTRAST` on the
  // background — synthesizing legible values when the ANSI palette cannot.
  const { accent, accent2, synthesized } = pickAccents(c, c.foreground);

  // Derive the four surface tokens as concrete OKLCH values, mode-aware and
  // scaled by the fg/bg luminance gap (see `deriveSurfaces`).
  const surfaces = deriveSurfaces(c.background, c.foreground, raw.isDark);

  const tokens: ResumeThemeTokens = {
    bg: c.background,
    fg: c.foreground,
    accent,
    accent2,
    muted: surfaces.muted,
    border: surfaces.border,
    card: surfaces.card,
    codeBg: surfaces.codeBg,
  };

  // Measure every contrast figure ourselves so the picker and `resumeSafe`
  // are grounded in real numbers. `fgOnBg` is recomputed (rather than reused
  // from `raw.contrast`) so all three figures come from one consistent
  // pipeline; it agrees with the dataset within ~0.04.
  const contrast: ResumeThemeContrast = {
    fgOnBg: contrastRatio(c.foreground, c.background),
    accentOnBg: contrastRatio(accent, c.background),
    accent2OnBg: contrastRatio(accent2, c.background),
  };

  return {
    slug: raw.slug,
    name: raw.name,
    isDark: raw.isDark,
    tokens,
    contrastRatio: contrast.fgOnBg,
    contrast,
    accentSynthesized: synthesized,
    // Honest `resumeSafe` (#47): body text must clear the resume-safe
    // threshold. Accent legibility is no longer in question — every theme's
    // accents are guaranteed ≥ ACCENT_MIN_CONTRAST by construction — so the
    // rule is exactly "is the body text comfortably readable?".
    resumeSafe: contrast.fgOnBg >= RESUME_SAFE_MIN_CONTRAST,
    // Facet tags for the picker's chip filter (#87) — see `deriveTags`.
    tags: deriveTags(raw),
  };
}

/* ------------------------------------------------------------------ */
/* Memoized normalized dataset (lazy-loaded via dynamic import)        */
/* ------------------------------------------------------------------ */

/**
 * Normalized themes once the dataset has been loaded. `null` until the
 * dynamic import resolves. Sync callers that need a value before then get
 * `HARDCODED_FALLBACK` (see `getAllThemes`, `findTheme`, `getFallbackTheme`).
 */
let normalizedCache: ResumeTheme[] | null = null;

/** Slug → theme index, built alongside `normalizedCache` for O(1) lookups. */
let slugIndex: Map<string, ResumeTheme> | null = null;

/**
 * In-flight load promise, so concurrent callers share one fetch rather than
 * each kicking off their own dynamic import. Resolves to the normalized list.
 */
let loadPromise: Promise<ResumeTheme[]> | null = null;

/**
 * True once the full dataset has been loaded and normalized into the cache.
 * Drives the picker's "Loading themes…" UX hint.
 */
export function themesLoaded(): boolean {
  return normalizedCache !== null;
}

/**
 * Lazily load the full ~465-theme dataset and normalize every entry.
 *
 * Returns the cached array on every subsequent call, so it is safe to invoke
 * repeatedly from React mount effects. The dynamic `import()` triggers Vite
 * to split `src/data/themes.json` into its own chunk (#78) — the main client
 * chunk no longer carries the ~600 kB literal.
 */
export async function loadAllThemesAsync(): Promise<ResumeTheme[]> {
  if (normalizedCache) return normalizedCache;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    // Dynamic import: Vite emits this JSON as its own asset chunk; the
    // network round-trip happens once, cached by the browser thereafter.
    const mod = await import('../data/themes.json');
    // The dataset is a ~465-entry literal. A direct `as RawTheme[]` would
    // force TypeScript into a slow deep structural check of the whole
    // literal, so we route through `unknown` — the shape is guaranteed by
    // how it was vendored.
    const rawThemes = mod.default as unknown as RawTheme[];
    const normalized = rawThemes.map(normalizeTheme);
    const index = new Map<string, ResumeTheme>();
    for (const theme of normalized) index.set(theme.slug, theme);
    normalizedCache = normalized;
    slugIndex = index;
    return normalized;
  })();

  return loadPromise;
}

/* ------------------------------------------------------------------ */
/* Last-resort hardcoded theme                                          */
/* ------------------------------------------------------------------ */

/**
 * An inline, dependency-free theme used only if the dataset is somehow
 * empty. `getFallbackTheme` MUST never throw, so this guarantees a value.
 * Plain neutral light theme — high contrast, resume-safe, and its accents
 * clear the accent floor (verified below in development).
 */
const HARDCODED_FALLBACK: ResumeTheme = {
  slug: 'womr-default',
  name: 'WOMR Default',
  isDark: false,
  tokens: {
    bg: 'oklch(1 0 0)',
    fg: 'oklch(0.25 0 0)',
    muted: 'oklch(0.5 0 0)',
    // Both accents are dark enough on white to clear 4.5:1 comfortably.
    accent: 'oklch(0.45 0.18 260)',
    accent2: 'oklch(0.48 0.13 200)',
    border: 'oklch(0.85 0 0)',
    card: 'oklch(0.98 0 0)',
    codeBg: 'oklch(0.95 0 0)',
  },
  // Hardcoded WCAG figures so this never depends on the dataset. Body text
  // (oklch 0.25 on white) is ~12:1; both accents clear the accent floor.
  contrastRatio: 12,
  contrast: { fgOnBg: 12, accentOnBg: 6.4, accent2OnBg: 5.8 },
  accentSynthesized: false,
  resumeSafe: true,
  // Mirrors the runtime derivation: a light theme with ~12:1 body contrast
  // and a near-neutral palette qualifies as `high-contrast` but not as
  // `vibrant` or `muted` (its only chromatic slots are the two accents,
  // which `deriveTags` doesn't consider — and neither would, given a
  // `RawTheme` shape for this fallback).
  tags: Object.freeze(['light', 'high-contrast'] as const),
};

/* ------------------------------------------------------------------ */
/* Curated, contrast-verified default & fallback slugs                  */
/* ------------------------------------------------------------------ */

/**
 * Curated fallback slugs, in descending preference order, for each mode.
 *
 * A resume is printed on white paper, so the app must default LIGHT (#49)
 * regardless of `prefers-color-scheme`. These were chosen by *measured*
 * quality from the theme-quality review — high `fgOnBg`, recognizable
 * names — but `getFallbackTheme` re-verifies each at runtime: a candidate
 * is only used if it exists in the dataset AND passes the contrast checks
 * (resume-safe body text, and accents clearing the accent floor — which the
 * engine guarantees, but we assert anyway as a defense-in-depth check).
 */
const CURATED_LIGHT_SLUGS = [
  'github-light-default', // fgOnBg ≈ 15.8 — measured best-in-class light
  'atom-one-light', //       fgOnBg ≈ 13.2
  'github', //               fgOnBg ≈ 9.7  — recognizable, safe
  'gruvbox-light', //        fgOnBg ≈ 10.2
] as const;

const CURATED_DARK_SLUGS = [
  'github-dark-default', //  fgOnBg ≈ 16.0 — measured best-in-class dark
  'dracula', //              fgOnBg ≈ 13.4 — recognizable
  'catppuccin-mocha', //     fgOnBg ≈ 11.3
  'tokyonight', //           fgOnBg ≈ 10.6 — recognizable
] as const;

/**
 * True when a normalized theme passes every contrast check we care about:
 * resume-safe body text, and both accents clearing the accent floor.
 * Used to validate curated fallback slugs at runtime.
 */
function passesContrastChecks(theme: ResumeTheme): boolean {
  return (
    theme.resumeSafe &&
    theme.contrast.accentOnBg >= ACCENT_MIN_CONTRAST &&
    theme.contrast.accent2OnBg >= ACCENT_MIN_CONTRAST
  );
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Every theme that is currently loaded, normalized into resume tokens.
 *
 * Synchronous, so it returns whatever the engine has on hand RIGHT NOW:
 *  - Before the dynamic import resolves: a single-element array holding
 *    `HARDCODED_FALLBACK`, so any consumer that iterates over the array
 *    still has a usable theme to display.
 *  - After `loadAllThemesAsync()` resolves: the full ~465 normalized themes.
 *
 * Callers that genuinely need the full dataset should call
 * `loadAllThemesAsync()` (and gate UX on `themesLoaded()`).
 */
export function getAllThemes(): ResumeTheme[] {
  return normalizedCache ?? [HARDCODED_FALLBACK];
}

/**
 * Look up a single theme by slug. `undefined` when no such slug exists in
 * the currently-loaded set (i.e. before `loadAllThemesAsync()` resolves,
 * only `HARDCODED_FALLBACK`'s slug is findable).
 */
export function findTheme(slug: string): ResumeTheme | undefined {
  if (slugIndex) return slugIndex.get(slug);
  return slug === HARDCODED_FALLBACK.slug ? HARDCODED_FALLBACK : undefined;
}

/**
 * Return a known-good, high-contrast, resume-safe theme of the requested
 * mode. Never throws — degrades through several layers:
 *
 *   1. The first curated slug for the mode that exists in the dataset AND
 *      passes the contrast checks (#49 — chosen by measured quality, not
 *      by name, and re-verified here).
 *   2. The first `resumeSafe` theme of the requested mode.
 *   3. The first theme of the requested mode, regardless of safety.
 *   4. The first theme in the dataset, regardless of mode.
 *   5. The inline `HARDCODED_FALLBACK` (only if the dataset is empty).
 *
 * @param prefersDark When true, return a dark theme; otherwise a light one.
 */
export function getFallbackTheme(prefersDark = false): ResumeTheme {
  // Dataset not yet loaded → the inline hardcoded theme is the only value
  // we can return synchronously. It is a light, high-contrast neutral, so
  // even a user who asked for dark gets a legible first paint; the real
  // resolved theme swaps in once `loadAllThemesAsync()` finishes.
  if (!normalizedCache || !slugIndex) {
    return HARDCODED_FALLBACK;
  }

  const themes = normalizedCache;

  // 1. First curated slug that both exists and passes contrast verification.
  const curated = prefersDark ? CURATED_DARK_SLUGS : CURATED_LIGHT_SLUGS;
  for (const slug of curated) {
    const theme = slugIndex.get(slug);
    if (theme && theme.isDark === prefersDark && passesContrastChecks(theme)) {
      return theme;
    }
  }

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
 *   3. A curated, contrast-verified LIGHT theme (#49).
 *
 * Light-by-default (#49): a resume is printed on white paper, so with no
 * explicit choice we ignore the OS `prefers-color-scheme` entirely and boot
 * a light theme. A user who wants dark picks one — and that choice is then
 * remembered via `localStorage` (step 2). The OS preference is therefore
 * deliberately *not* consulted here.
 *
 * SSR-safe: every `window` access is guarded, so during Astro's build this
 * resolves purely against the dataset's curated light fallback.
 */
export function resolveInitialThemeSlug(): string {
  // URL > storage > curated light fallback. Before the dataset is loaded
  // we still HONOR the URL / stored slug as the user's expressed intent —
  // the slug is a primitive, not a theme object — so the caller (which
  // awaits `loadAllThemesAsync()` and then resolves the slug to a real
  // `ResumeTheme`) reapplies the requested theme as soon as it's available.

  // 1. URL parameter — honored verbatim (validated against the dataset
  //    when the dataset is here; otherwise trusted as the user's intent).
  if (typeof window !== 'undefined' && window.location?.search) {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlSlug = params.get('theme');
      if (urlSlug) {
        if (slugIndex) {
          if (slugIndex.has(urlSlug)) return urlSlug;
          // Dataset loaded but the slug is unknown → fall through to storage.
        } else {
          // Dataset not yet loaded: trust the URL. The caller validates
          // post-load and falls back if the slug turns out to be bogus.
          return urlSlug;
        }
      }
    } catch {
      /* malformed query string — ignore and continue */
    }
  }

  // 2. Stored preference (this is where a deliberate dark choice persists).
  const stored = getStoredThemeSlug();
  if (stored) {
    if (slugIndex) {
      if (slugIndex.has(stored)) return stored;
    } else {
      return stored;
    }
  }

  // 3. No signal at all → always a curated light theme, regardless of the
  //    OS color-scheme preference. Falls back to HARDCODED_FALLBACK's slug
  //    when the dataset hasn't loaded yet.
  return getFallbackTheme(false).slug;
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
 * Filter a list of themes by a free-text query and an optional set of facet
 * tags (#87).
 *
 * Composition rules (ANDed together so the user can stack constraints
 * without the picker quietly losing one of them):
 *  - `query` : case-insensitive substring match against `name` and `slug`.
 *              Empty / whitespace-only matches everything.
 *  - `tags`  : when provided AND non-empty, every listed tag must be present
 *              on the theme's `tags` array. Passing `undefined` (or an empty
 *              array) means "no tag filter".
 *
 * Note: the "resume-safe only" toggle was retired in #153. Every theme in
 * the dataset now clears `RESUME_SAFE_MIN_CONTRAST` by construction (the 80
 * unsafe themes were dropped from `src/data/themes.json`), so the parameter
 * had nothing left to filter and was removed from the signature.
 *
 * Pure and stable: the returned array preserves the input order, so the
 * picker's existing keyboard-navigation and index-based UI keep working.
 */
export function filterThemes(
  themes: ResumeTheme[],
  query: string,
  tags?: readonly string[],
): ResumeTheme[] {
  const needle = query.trim().toLowerCase();
  // Normalize: an undefined or empty list disables the tag filter entirely.
  // We don't bother dropping duplicates — `every` on a duplicated tag is
  // still correct.
  const requiredTags = tags && tags.length > 0 ? tags : null;
  return themes.filter((theme) => {
    if (requiredTags) {
      const themeTags: readonly string[] = theme.tags;
      for (const tag of requiredTags) {
        if (!themeTags.includes(tag)) return false;
      }
    }
    if (needle.length === 0) return true;
    return theme.name.toLowerCase().includes(needle) || theme.slug.toLowerCase().includes(needle);
  });
}

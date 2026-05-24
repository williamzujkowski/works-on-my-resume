/**
 * ThemePresets — curated single-click theme + layout pills (#95).
 *
 * Three audience-aimed presets that each apply BOTH a theme and a layout in
 * one click, so a visitor who is not interested in the picker can still get
 * a tasteful first impression without browsing 545 themes:
 *
 *   - Conservative → classic layout + `github-light-default` theme
 *   - Modern       → modern  layout + `dracula` theme
 *   - Creative     → compact layout + `popping-and-locking` theme
 *
 * Each pill is a real `<button>` with `aria-pressed` reflecting whether the
 * currently committed theme/layout matches the preset. Active state gets a
 * visible accent treatment. The row wraps on narrow viewports — see the
 * `@media (max-width: 720px)` rule in global.css.
 *
 * Compatibility with the resume-safe-only filter: applying a preset whose
 * theme is outside the filtered option list still works — the active theme
 * is allowed to be outside the filtered set (that's already how single
 * theme selections behave today). The picker just won't surface the active
 * theme inside its option list while the filter is on; the preset row is
 * unaffected.
 */
import { useCallback } from 'react';
import type { ResumeTemplate, ResumeTheme } from '../types';
import { findTheme, getFallbackTheme, loadAllThemesAsync } from '../utils/themes';

/** One curated audience preset. */
export interface ThemePreset {
  /** Internal id (stable, used as React key and `data-preset`). */
  id: 'conservative' | 'modern' | 'creative';
  /** Visible label on the pill. */
  label: string;
  /** Layout template applied when this preset is clicked. */
  template: ResumeTemplate;
  /** Theme slug applied when this preset is clicked. */
  themeSlug: string;
  /** Short helper text, exposed as the button's `title`/`aria-label`. */
  description: string;
}

/** The full ordered set of curated presets — the only source of truth. */
export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: 'conservative',
    label: 'Conservative',
    template: 'classic',
    themeSlug: 'github-light-default',
    description: 'Classic layout with a calm light theme — safest for traditional reviewers.',
  },
  {
    id: 'modern',
    label: 'Modern',
    template: 'modern',
    themeSlug: 'dracula',
    description: 'Modern layout with the Dracula dark theme — for tech-forward reviewers.',
  },
  {
    id: 'creative',
    label: 'Creative',
    template: 'compact',
    themeSlug: 'popping-and-locking',
    description: 'Compact layout with a vibrant theme — for design-forward roles.',
  },
] as const;

interface ThemePresetsProps {
  /** Currently committed theme — feeds the active-pill computation. */
  currentTheme: ResumeTheme;
  /** Currently committed layout template — feeds the active-pill computation. */
  currentTemplate: ResumeTemplate;
  /** Commit a theme (same callback ResumeStudio passes to ThemePicker). */
  onThemeChange: (theme: ResumeTheme) => void;
  /** Commit a layout template (same callback ResumeStudio passes to LayoutSelector). */
  onTemplateChange: (template: ResumeTemplate) => void;
}

/**
 * True iff the given preset's theme + template match what is currently
 * committed. We compare BOTH so a half-match (correct theme, wrong layout)
 * does not light up the pill — the preset is a complete look, not a hint.
 */
function isPresetActive(
  preset: ThemePreset,
  currentTheme: ResumeTheme,
  currentTemplate: ResumeTemplate,
): boolean {
  return preset.themeSlug === currentTheme.slug && preset.template === currentTemplate;
}

export default function ThemePresets({
  currentTheme,
  currentTemplate,
  onThemeChange,
  onTemplateChange,
}: ThemePresetsProps) {
  /**
   * Apply one curated preset. The layout is purely local state, so it
   * commits synchronously. The theme MAY not be in the synchronous cache
   * yet — until `loadAllThemesAsync()` resolves the only findable slug is
   * the boot fallback. We try the sync `findTheme` first; if it misses we
   * trigger the lazy load (which the user opening the picker would do
   * anyway) and apply the resolved theme once it's available. If the slug
   * is genuinely unknown after loading, fall back to a safe theme of the
   * preset's mode so the pill never lands the user in an inconsistent
   * state.
   */
  const applyPreset = useCallback(
    (preset: ThemePreset) => {
      // Commit the layout immediately — it's available synchronously.
      onTemplateChange(preset.template);

      const sync = findTheme(preset.themeSlug);
      if (sync) {
        onThemeChange(sync);
        return;
      }
      // Theme dataset not loaded yet — kick it off, then commit. We
      // intentionally do not block the click on the dataset; the layout has
      // already changed so the user sees immediate feedback.
      void loadAllThemesAsync()
        .then(() => {
          const resolved = findTheme(preset.themeSlug);
          if (resolved) {
            onThemeChange(resolved);
          } else {
            // Slug isn't in the dataset (shouldn't happen for curated values,
            // but defend anyway). Land on a safe fallback of the same mode —
            // dracula is dark, the others are light — rather than no-op.
            const wantDark = preset.id === 'modern';
            onThemeChange(getFallbackTheme(wantDark));
          }
        })
        .catch(() => {
          // Network / chunk-load failure: keep whatever theme is already
          // applied. The layout change persists either way.
        });
    },
    [onThemeChange, onTemplateChange],
  );

  return (
    <div className="theme-presets" role="group" aria-label="Curated presets">
      <span className="theme-presets__kicker" aria-hidden="true">
        Presets
      </span>
      <div className="theme-presets__row">
        {THEME_PRESETS.map((preset) => {
          const active = isPresetActive(preset, currentTheme, currentTemplate);
          const classNames = ['theme-presets__pill'];
          if (active) classNames.push('theme-presets__pill--active');
          return (
            <button
              key={preset.id}
              type="button"
              className={classNames.join(' ')}
              data-preset={preset.id}
              aria-pressed={active}
              title={preset.description}
              aria-label={`${preset.label} preset — ${preset.description}`}
              onClick={() => applyPreset(preset)}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

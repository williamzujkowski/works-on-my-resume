/**
 * ThemePicker — a collapsed theme control that opens a search popover.
 *
 * Collapsed, it is a single button showing the current theme's name and a
 * color swatch. Activating it (or pressing the global `/` shortcut) opens a
 * popover containing the search input and a results list. The popover closes
 * on Escape, outside-click, and selection.
 *
 * ARIA: the trigger is a real `combobox`-less disclosure; inside the popover
 * the search input is the `combobox` (`aria-expanded` tracks the open state,
 * `aria-activedescendant` points at the active option's `id`). Each option
 * carries a stable `id`. Arrow-key moves are announced via a polite live
 * region so screen-reader users hear the highlighted theme.
 *
 * The full dataset is ~465 themes (#153 dropped the 80 themes whose body
 * text fell below the resume-safe 7:1 threshold; every remaining theme is
 * legible, so the picker's "Resume-safe themes only" toggle went away with
 * them). The option list mounts all filtered matches directly (no render cap,
 * no "refine your search" hint), so users browsing for "Tomorrow Night" or
 * "Zenwritten Light" actually see them in the list.
 *
 * Preview-on-hover (#60): hovering or keyboard-focusing an option live-applies
 * that theme to the document so browsing 465 themes is visual, not blind. The
 * preview writes ONLY to the document (`applyThemeToDocument`) — never to the
 * committed state, the URL, or localStorage. Those are touched only by a real
 * selection (`onSelect`). If the popover closes without a selection, the theme
 * that was active when it opened is restored.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ResumeTheme, ResumeThemeTag } from '../types';
import { RESUME_THEME_TAGS } from '../types';
import {
  applyThemeToDocument,
  CURATED_STARTING_POINTS,
  filterThemes,
  findTheme,
  loadAllThemesAsync,
} from '../utils/themes';
import { wcagLevel } from '../utils/wcag';
import Icon from './Icon';

/* ----------------------------------------------------------------------------
 * Note: the "Resume-safe themes only" toggle was removed in #153.
 * Every theme in the dataset now clears the resume-safe 7:1 body-text
 * threshold by construction (80 unsafe themes were dropped from
 * `src/data/themes.json` in the same change), so the toggle had nothing left
 * to filter. The unsafe-badge / low-contrast trigger glyph / below-threshold
 * footer warning all went with it for the same reason.
 * -------------------------------------------------------------------------- */

/* ----------------------------------------------------------------------------
 * CSP-friendly swatch primitives.
 *
 * The picker has to paint per-theme background / border colors that the CSS
 * cannot know at build time — there are 545 themes and the tokens come from
 * runtime state. The historical implementation used a React `style={...}`
 * attribute, which forces `style-src 'unsafe-inline'` to allow it (#38).
 *
 * Instead, these components mount a ref and then in `useLayoutEffect` write
 * the colors directly via the CSSOM (`el.style.setProperty(...)`). CSSOM
 * mutations from script are NOT covered by `style-src` — they are governed
 * by `script-src`, which is locked to `'self'` + Astro-emitted hashes — so
 * this dodges `'unsafe-inline'` cleanly while keeping the swatches visually
 * identical to the inline-style version.
 * -------------------------------------------------------------------------- */

interface ThemeSwatchProps {
  /** Class applied to the swatch element (sizes/borders/etc. via CSS). */
  className: string;
  /** Color painted on `background-color`. */
  background: string;
  /** Color painted on `border-color`. */
  borderColor: string;
}

/** Square theme swatch (trigger + option list). Paints colors via CSSOM. */
function ThemeSwatch({ className, background, borderColor }: ThemeSwatchProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('background-color', background);
    el.style.setProperty('border-color', borderColor);
  }, [background, borderColor]);
  return <span ref={ref} className={className} aria-hidden="true" />;
}

interface AccentDotProps {
  className: string;
  /** Color painted on `background-color`. */
  background: string;
}

/** Small circular accent indicator. Paints color via CSSOM. */
function AccentDot({ className, background }: AccentDotProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('background-color', background);
  }, [background]);
  return <span ref={ref} className={className} aria-hidden="true" />;
}

interface CuratedStartingPointProps {
  /** The hydrated theme — already verified to exist in the dataset. */
  theme: ResumeTheme;
  /** Editorial caption shown below the theme name. */
  caption: string;
  /** Selection handler — same one the listbox `<li>` rows call. */
  onSelect: (theme: ResumeTheme) => void;
}

/**
 * One curated "Starting points" tile (#183).
 *
 * A small clickable row with a square swatch (painted via CSSOM to dodge
 * `style-src 'unsafe-inline'`, per the CSP pattern used by `ThemeSwatch`
 * above), the theme name in serif, and the editorial caption in muted serif.
 * Click commits the theme + closes the picker through `onSelect` — the same
 * handler the main listbox rows use.
 */
function CuratedStartingPoint({ theme, caption, onSelect }: CuratedStartingPointProps) {
  return (
    <button
      type="button"
      className="theme-picker__curated-item"
      data-slug={theme.slug}
      onClick={() => onSelect(theme)}
    >
      <ThemeSwatch
        className="theme-picker__swatch theme-picker__curated-swatch"
        background={theme.tokens.bg}
        borderColor={theme.tokens.accent}
      />
      <span className="theme-picker__curated-text">
        <span className="theme-picker__curated-name">{theme.name}</span>
        <span className="theme-picker__curated-caption">{caption}</span>
      </span>
    </button>
  );
}

// Note: an earlier MAX_RENDERED cap (60) was removed — it hid most of the
// dataset behind a "refine your search" hint, which read to users as
// "the list stops at B". A few hundred simple option rows mount comfortably
// within the click-to-popover interaction budget on a modern browser.

interface ThemePickerProps {
  /** All currently-available themes (just the boot fallback until the
      ~465-theme dataset finishes loading; see #78). */
  themes: ResumeTheme[];
  /** True while the dataset is still streaming in via dynamic import.
      Drives the "Loading themes…" line inside the popover so the user
      knows the option list will grow in a moment. */
  themesLoading: boolean;
  /** The currently applied theme. */
  current: ResumeTheme;
  /** Current search query (controlled by ResumeStudio). */
  query: string;
  onQueryChange: (query: string) => void;
  /** Called when a theme is chosen. */
  onSelect: (theme: ResumeTheme) => void;
  /** DOM id for the search input, so the `/` shortcut can focus it. */
  searchInputId: string;
  /** Whether the popover is open (controlled by ResumeStudio). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ThemePicker({
  themes,
  themesLoading,
  current,
  query,
  onQueryChange,
  onSelect,
  searchInputId,
  open,
  onOpenChange,
}: ThemePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  /* ----- Facet-tag chip filter (#87) -----
     Local to the picker because the chips are part of the picker's own UI
     contract. Not persisted — the picker opens with a clean slate each
     session, which matches the older "Resume-safe themes only" toggle's
     session-scoped lifetime before it was retired in #153. */
  const [activeTags, setActiveTags] = useState<readonly ResumeThemeTag[]>([]);
  const toggleTag = useCallback((tag: ResumeThemeTag) => {
    setActiveTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }, []);
  const resetTags = useCallback(() => setActiveTags([]), []);

  /* ----- Preview-on-hover bookkeeping (#60) -----
     `baseThemeRef`    — the committed theme when the popover opened; the theme
                         to restore if it closes without a selection.
     `committedRef`    — set true the instant a real selection is made, so the
                         cleanup effect knows NOT to revert.
     `previewSlugRef`  — the slug currently applied to the document, so we can
                         skip redundant re-applications (which would thrash the
                         crossfade as the pointer sweeps the list).
     `hasPreviewedRef` — true once a theme OTHER than the base has been
                         previewed; gates whether a revert is needed on close. */
  const baseThemeRef = useRef<ResumeTheme>(current);
  const committedRef = useRef(false);
  const previewSlugRef = useRef<string | null>(null);
  const hasPreviewedRef = useRef(false);

  const idBase = useId();
  const listId = `${searchInputId}-list`;
  const liveId = `${idBase}-live`;
  const optionId = (slug: string) => `${idBase}-opt-${slug}`;

  const allMatches = useMemo(
    () => filterThemes(themes, query, activeTags),
    [themes, query, activeTags],
  );
  // Render every match. `rendered` stays as the bound name used throughout
  // this component (active-index, onOpen snapshot, keyboard nav).
  const rendered = allMatches;

  /* ----- Curated "Starting points" row (#183) -----
     "Filtered mode" means the user has narrowed the picker with the search
     input or a tag chip; in that mode the curated row hides and the count
     line takes over the role of telling the user what they're looking at.
     `query.trim()` so a stray whitespace fill doesn't toggle modes. */
  const isFiltered = query.trim().length > 0 || activeTags.length > 0;

  /* Hydrate each curated slug against the loaded dataset. Slugs missing from
     the dataset (typo in CURATED_STARTING_POINTS, or the boot-fallback state
     before lazy-load resolves) are silently dropped — the row simply shrinks
     rather than rendering a broken swatch. The boot fallback case fixes
     itself once `loadAllThemesAsync()` resolves and the picker re-renders. */
  const curatedEntries = useMemo(
    () =>
      CURATED_STARTING_POINTS.map((entry) => {
        const theme = findTheme(entry.slug);
        return theme ? { theme, caption: entry.caption } : null;
      }).filter((entry): entry is { theme: ResumeTheme; caption: string } => entry !== null),
    // `themes` is the cheapest signal that the lazy dataset finished
    // loading — every theme hydrates once and stays hydrated for the session,
    // so this memo re-runs at most twice: boot fallback, then the full set.
    [themes],
  );

  /* The denominator in the "X of Y themes" count (#87). `themes.length`
     reads as the *full set* of themes the picker has on hand — neither the
     search query nor the tag chips are subtracted from it — so the count
     tells a coherent story as filters are applied ("you are seeing X of all
     Y"). Cheap to compute; no memo needed. */
  const totalThemes = themes.length;

  /* Keep the active index inside bounds as the filtered list changes. */
  useEffect(() => {
    setActiveIndex((index) => (rendered.length === 0 ? 0 : Math.min(index, rendered.length - 1)));
  }, [rendered.length]);

  /* `onOpen` reads the latest rendered list / current theme without making
     the open-effect re-run on every keystroke (which would fight the caret).
     A ref keeps the freshest snapshot; the effect depends only on `open`. */
  const openSnapshotRef = useRef({ rendered, currentSlug: current.slug });
  openSnapshotRef.current = { rendered, currentSlug: current.slug };

  /* When the popover opens: snapshot the committed theme (the revert target),
     clear the preview/commit flags, focus the search input, and reset the
     highlight to the current theme if it is visible.

     On close: if no real selection was made, restore the snapshotted theme so
     a preview never lingers as if it had been chosen. */
  useEffect(() => {
    if (!open) return;
    // Lazy-load the ~465-theme dataset (#80): the dynamic import is the
    // primary trigger here, so a user who never opens the picker pays
    // nothing for the chunk. `loadAllThemesAsync` memoizes the in-flight /
    // completed promise, so reopening the popover is a no-op — and the
    // ResumeStudio idle-callback path that handles `?theme=` users hits the
    // same cache. Fire-and-forget: ResumeStudio's `.then` handler picks up
    // the dataset, switches `themesLoading` off, and re-resolves the active
    // slug if needed. Errors are absorbed there too.
    void loadAllThemesAsync().catch(() => {
      /* surfaced by ResumeStudio's load-handler */
    });
    baseThemeRef.current = current;
    committedRef.current = false;
    // Seed the preview slug with the already-applied theme: highlighting it on
    // open is then a no-op, so the popover does not re-trigger the crossfade
    // just by opening. A revert is only needed once a *different* theme has
    // been previewed — tracked below.
    previewSlugRef.current = current.slug;
    hasPreviewedRef.current = false;

    const { rendered: list, currentSlug } = openSnapshotRef.current;
    const idx = list.findIndex((t) => t.slug === currentSlug);
    setActiveIndex(idx === -1 ? 0 : idx);
    // Defer so the input is mounted.
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);

    return () => {
      window.clearTimeout(id);
      // Closed without a selection, after previewing a different theme →
      // restore the theme that was active when the popover opened.
      if (!committedRef.current && hasPreviewedRef.current) {
        applyThemeToDocument(baseThemeRef.current);
      }
      previewSlugRef.current = null;
      hasPreviewedRef.current = false;
    };
    // Keyed solely on `open`: `current` is read only at open time on purpose —
    // re-running on every committed theme change would re-snapshot mid-session.
  }, [open]);

  /* Live-preview a theme by applying it to the document only. Never writes
     committed state / URL / storage. Skips redundant re-applies so a pointer
     sweeping the list does not retrigger the theme crossfade repeatedly. */
  const preview = useCallback((theme: ResumeTheme) => {
    if (previewSlugRef.current === theme.slug) return;
    previewSlugRef.current = theme.slug;
    // Note that we have diverged from the base theme — a revert is now needed
    // if the popover closes without a real selection.
    if (theme.slug !== baseThemeRef.current.slug) {
      hasPreviewedRef.current = true;
    }
    applyThemeToDocument(theme);
  }, []);

  /* Scroll the active option into view while navigating by keyboard. */
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const option = list?.children[activeIndex] as HTMLElement | undefined;
    option?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  /* Keyboard navigation previews the highlighted theme too — so arrow-key
     browsing is as visual as pointer hover. The preview helper de-dupes, so
     this is safe to run on every activeIndex change. Keyed on the active
     theme's slug (a stable primitive) rather than the `rendered` array. */
  const activeSlug = rendered[activeIndex]?.slug;
  useEffect(() => {
    if (!open || !activeSlug) return;
    const active = rendered.find((t) => t.slug === activeSlug);
    if (active) preview(active);
  }, [open, activeSlug, rendered, preview]);

  /* Close on outside-click. */
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, onOpenChange]);

  function close(restoreFocus = true) {
    // The open-effect cleanup reverts any preview when committedRef is false.
    onOpenChange(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function choose(theme: ResumeTheme) {
    // Mark BEFORE closing so the cleanup effect skips the revert. onSelect is
    // the real commit — it writes state, the URL, and localStorage.
    committedRef.current = true;
    onSelect(theme);
    close();
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (rendered.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % rendered.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + rendered.length) % rendered.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(rendered.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const theme = rendered[activeIndex];
      if (theme) choose(theme);
    }
  }

  const activeTheme = rendered[activeIndex];
  const activeDescId = activeTheme ? optionId(activeTheme.slug) : undefined;

  /* Note: the trigger's low-contrast alert glyph was removed in #153.
     Every theme in the dataset now clears the resume-safe threshold by
     construction, so the warning glyph could never fire. */

  return (
    <div className="theme-picker" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="theme-picker__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <ThemeSwatch
          className="theme-picker__swatch theme-picker__swatch--trigger"
          background={current.tokens.bg}
          borderColor={current.tokens.accent}
        />
        <span className="theme-picker__trigger-label">
          <span className="theme-picker__trigger-kicker section-kicker">Theme</span>
          <span className="theme-picker__trigger-name">{current.name}</span>
        </span>
        <Icon name="chevron-down" className="theme-picker__trigger-caret" />
      </button>

      {open && (
        <div className="theme-picker__popover" role="dialog" aria-label="Choose a theme">
          {/* Curated "Starting points" row (#183).
              Eight hand-picked themes the writer can land on in one click. Hidden
              when the user has narrowed the picker with a search query or any tag
              chip — the existing count line takes over the role of "what am I
              looking at" in that filtered state. Slugs missing from the dataset
              are silently skipped so a typo in CURATED_STARTING_POINTS never
              renders a broken swatch. */}
          {!isFiltered && curatedEntries.length > 0 && (
            <div
              className="theme-picker__curated"
              role="group"
              aria-label="Starting points"
            >
              <p className="theme-picker__curated-kicker section-kicker">Starting points</p>
              <div className="theme-picker__curated-grid">
                {curatedEntries.map(({ theme, caption }) => (
                  <CuratedStartingPoint
                    key={theme.slug}
                    theme={theme}
                    caption={caption}
                    onSelect={choose}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="theme-picker__search-row">
            <span className="theme-picker__search-icon" aria-hidden="true">
              <Icon name="search" />
            </span>
            <label className="visually-hidden" htmlFor={searchInputId}>
              Search themes
            </label>
            <input
              id={searchInputId}
              ref={inputRef}
              className="text-input theme-picker__search"
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeDescId}
              placeholder="Search themes…"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
          </div>

          {/* Lazy-load indicator (#78). The theme dataset code-splits;
              while it streams in, the option list is just the boot fallback.
              The status line tells users (sighted and SR alike) that the
              full picker is on its way — `role="status"` announces politely.
              Reuses the `__refine` class for its small, subtle styling so
              this fits the popover without needing new CSS. */}
          {themesLoading && (
            <p className="theme-picker__refine" role="status">
              Loading themes…
            </p>
          )}

          {/* Facet-tag chip row (#87). Each chip is a real <button> with
              `aria-pressed` so toggling is announced by AT and the row is
              navigable via Tab — it explicitly does NOT participate in the
              arrow-key model of the option listbox, which keeps the
              search-input → listbox keyboard pair intact (the `/` shortcut
              still focuses the search input). The `Reset` chip materializes
              only when at least one tag is active so the row stays quiet
              for users who never touch it. */}
          <div className="theme-picker__tags" role="group" aria-label="Filter themes by tag">
            {RESUME_THEME_TAGS.map((tag) => {
              const pressed = activeTags.includes(tag);
              const classNames = ['theme-picker__tag'];
              if (pressed) classNames.push('theme-picker__tag--active');
              return (
                <button
                  key={tag}
                  type="button"
                  className={classNames.join(' ')}
                  data-tag={tag}
                  aria-pressed={pressed}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </button>
              );
            })}
            {activeTags.length > 0 && (
              <button
                type="button"
                className="theme-picker__tag theme-picker__tag--reset"
                onClick={resetTags}
              >
                Reset
              </button>
            )}
          </div>

          {/* The "Resume-safe themes only" toggle that sat here was removed
              in #153 — every theme in the dataset is resume-safe by
              construction now, so the toggle was a permanent no-op. */}

          {/* Live match count (#87). Sits between the chip row and
              the listbox so the user can see — and AT users can hear — the
              effect of every filter change in one place. Polite + atomic so
              screen readers re-announce the whole short sentence rather
              than diffing a single number. Tabular-nums in CSS keeps the
              count from jittering as digits change.

              #183: hidden in the unfiltered baseline — the curated "Starting
              points" row above takes over the "what am I looking at" role
              there. The line returns the moment the user types in the search
              box or activates a tag chip, so the feedback loop is preserved
              for every filter action. */}
          {isFiltered && (
            <p className="theme-picker__count" aria-live="polite" aria-atomic="true">
              {rendered.length} of {totalThemes} themes
            </p>
          )}

          {/* Polite live region — announces the keyboard-highlighted theme. */}
          <p id={liveId} className="visually-hidden" aria-live="polite">
            {activeTheme
              ? `${activeTheme.name}, ${activeTheme.isDark ? 'dark' : 'light'} theme, ` +
                `option ${activeIndex + 1} of ${rendered.length}`
              : ''}
          </p>

          {rendered.length === 0 ? (
            <p className="theme-picker__empty" role="status">
              No themes match “{query}”.
            </p>
          ) : (
            <ul
              ref={listRef}
              id={listId}
              className="theme-picker__list"
              role="listbox"
              aria-label="Themes"
            >
              {rendered.map((theme, index) => {
                const isSelected = theme.slug === current.slug;
                const isActive = index === activeIndex;
                const classNames = ['theme-picker__option'];
                if (isActive) classNames.push('theme-picker__option--active');
                if (isSelected) classNames.push('theme-picker__option--selected');
                return (
                  <li
                    key={theme.slug}
                    id={optionId(theme.slug)}
                    className={classNames.join(' ')}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => choose(theme)}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <ThemeSwatch
                      className="theme-picker__swatch"
                      background={theme.tokens.bg}
                      borderColor={theme.tokens.accent}
                    />
                    <span className="theme-picker__option-name">{theme.name}</span>
                    {theme.accentSynthesized && (
                      <span className="badge" title="Accent adjusted for legible contrast">
                        accent adj.
                      </span>
                    )}
                    {/* The per-option "low contrast" badge was removed in
                        #153: every theme in the dataset clears the
                        resume-safe threshold, so the badge could never
                        fire on a real option row. */}
                    <span className={theme.isDark ? 'badge badge--dark' : 'badge badge--light'}>
                      {theme.isDark ? 'dark' : 'light'}
                    </span>
                    {isSelected && (
                      <span className="theme-picker__option-check" aria-hidden="true">
                        <Icon name="check" size={14} />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* The full filtered list is rendered (no cap). The contrast
              readout below carries the legibility context for the committed
              theme; a verbose match-count footer would just be noise. */}

          {/* Legibility readout for the committed theme — body text and
              accent contrast, each labelled with its WCAG level so the bare
              ratio is self-explanatory. Mirrors the ThemeControls badges.

              #153 simplified this: every theme is resume-safe now, so the
              "below resume-safe" warning state was removed. The check glyph
              is fixed-on; only the numbers vary. */}
          <div className="theme-picker__contrast">
            <p
              className="theme-picker__contrast-row"
              title={`Body text contrast ${current.contrastRatio.toFixed(
                1,
              )}:1 — WCAG ${wcagLevel(current.contrastRatio)}`}
            >
              <span
                className="theme-picker__contrast-icon theme-picker__contrast-icon--ok"
                aria-hidden="true"
              >
                <Icon name="check" size={13} />
              </span>
              Body text {current.contrastRatio.toFixed(1)}:1 — WCAG{' '}
              {wcagLevel(current.contrastRatio)}
            </p>
            <p
              className="theme-picker__contrast-row"
              title={`Accent contrast ${current.contrast.accentOnBg.toFixed(
                1,
              )}:1 — WCAG ${wcagLevel(current.contrast.accentOnBg)}`}
            >
              <AccentDot className="theme-picker__accent-dot" background={current.tokens.accent} />
              Accent {current.contrast.accentOnBg.toFixed(1)}:1 — WCAG{' '}
              {wcagLevel(current.contrast.accentOnBg)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

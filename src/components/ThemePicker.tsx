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
 * The full dataset is ~545 themes; only the first MAX_RENDERED matches are
 * mounted, with a "refine your search" hint, so the option list never mounts
 * 545 nodes at once.
 *
 * Preview-on-hover (#60): hovering or keyboard-focusing an option live-applies
 * that theme to the document so browsing 545 themes is visual, not blind. The
 * preview writes ONLY to the document (`applyThemeToDocument`) — never to the
 * committed state, the URL, or localStorage. Those are touched only by a real
 * selection (`onSelect`). If the popover closes without a selection, the theme
 * that was active when it opened is restored.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ResumeTheme } from '../types';
import { applyThemeToDocument, filterThemes } from '../utils/themes';
import Icon from './Icon';

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

/** WCAG conformance level of a contrast ratio for normal-size text. */
function wcagLevel(ratio: number): 'AAA' | 'AA' | 'fails AA' {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  return 'fails AA';
}

/** Cap on rendered option nodes — keeps the popover light. */
const MAX_RENDERED = 60;

interface ThemePickerProps {
  /** All available themes. */
  themes: ResumeTheme[];
  /** The currently applied theme. */
  current: ResumeTheme;
  /** Current search query (controlled by ResumeStudio). */
  query: string;
  onQueryChange: (query: string) => void;
  /** "Resume-safe themes only" toggle state. */
  resumeSafeOnly: boolean;
  onResumeSafeOnlyChange: (value: boolean) => void;
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
  current,
  query,
  onQueryChange,
  resumeSafeOnly,
  onResumeSafeOnlyChange,
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
    () => filterThemes(themes, query, resumeSafeOnly),
    [themes, query, resumeSafeOnly],
  );
  const rendered = allMatches.slice(0, MAX_RENDERED);
  const overflow = allMatches.length - rendered.length;

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

  /* Honest, non-blocking signal on the always-visible trigger: when the
     committed theme's body text falls below the resume-safe threshold, show
     an alert glyph beside the name. The icon + aria-label carry the meaning,
     so the warning is never conveyed by colour alone. */
  const lowContrast = !current.resumeSafe;
  const triggerContrastLabel = `Body text contrast ${current.contrastRatio.toFixed(
    1,
  )}:1 — WCAG ${wcagLevel(current.contrastRatio)}, below the resume-safe threshold`;

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
          <span className="theme-picker__trigger-kicker">theme</span>
          <span className="theme-picker__trigger-name">{current.name}</span>
        </span>
        {lowContrast && (
          <span
            className="theme-picker__trigger-warning"
            title={triggerContrastLabel}
            aria-label={triggerContrastLabel}
            role="img"
          >
            <Icon name="alert" size={14} />
          </span>
        )}
        <Icon name="chevron-down" className="theme-picker__trigger-caret" />
      </button>

      {open && (
        <div className="theme-picker__popover" role="dialog" aria-label="Choose a theme">
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
              placeholder="Search 545 themes…"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
          </div>

          <label className="theme-picker__checkbox">
            <input
              type="checkbox"
              checked={resumeSafeOnly}
              onChange={(event) => onResumeSafeOnlyChange(event.target.checked)}
            />
            Resume-safe themes only
          </label>

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
                    {!theme.resumeSafe && (
                      <span
                        className="badge badge--unsafe"
                        title={`Body text contrast ${theme.contrastRatio.toFixed(
                          1,
                        )}:1 — WCAG ${wcagLevel(theme.contrastRatio)}, below the resume-safe threshold`}
                        role="img"
                        aria-label={`Low body-text contrast, ${theme.contrastRatio.toFixed(
                          1,
                        )} to 1`}
                      >
                        <Icon name="alert" size={11} />
                        low contrast
                      </span>
                    )}
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

          {overflow > 0 && (
            <p className="theme-picker__refine" role="status">
              Showing {rendered.length} of {allMatches.length} — refine your search to narrow it
              down.
            </p>
          )}

          {/* Legibility readout for the committed theme — body text and
              accent contrast, each labelled with its WCAG level so the bare
              ratio is self-explanatory. Mirrors the ThemeControls badges. */}
          <div className="theme-picker__contrast">
            <p
              className="theme-picker__contrast-row"
              title={`Body text contrast ${current.contrastRatio.toFixed(
                1,
              )}:1 — WCAG ${wcagLevel(current.contrastRatio)}`}
            >
              <span
                className={
                  current.resumeSafe
                    ? 'theme-picker__contrast-icon theme-picker__contrast-icon--ok'
                    : 'theme-picker__contrast-icon theme-picker__contrast-icon--warn'
                }
                aria-hidden="true"
              >
                <Icon name={current.resumeSafe ? 'check' : 'alert'} size={13} />
              </span>
              Body text {current.contrastRatio.toFixed(1)}:1 — WCAG{' '}
              {wcagLevel(current.contrastRatio)}
              {!current.resumeSafe && ', below resume-safe'}
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

/**
 * ThemePicker — a searchable, keyboard-navigable theme list.
 *
 * Implemented as a listbox with an associated search input. The search input
 * carries a stable `id` (passed in by ResumeStudio) so the global `/`
 * shortcut can focus it. Filtering is delegated entirely to the shared
 * `filterThemes` utility, including the "resume-safe only" predicate.
 */
import { useEffect, useRef, useState } from 'react';
import type { ResumeTheme } from '../types';
import { filterThemes } from '../utils/themes';

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
}: ThemePickerProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = filterThemes(themes, query, resumeSafeOnly);

  // Keep the active (keyboard-highlighted) index inside bounds as the
  // filtered list changes.
  useEffect(() => {
    setActiveIndex((index) => (filtered.length === 0 ? 0 : Math.min(index, filtered.length - 1)));
  }, [filtered.length]);

  /** Scroll the active option into view when navigating by keyboard. */
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const option = list.children[activeIndex] as HTMLElement | undefined;
    option?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (filtered.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % filtered.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + filtered.length) % filtered.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const theme = filtered[activeIndex];
      if (theme) onSelect(theme);
    }
  }

  const listId = `${searchInputId}-list`;

  return (
    <div className="theme-picker">
      <div className="theme-picker__search-row">
        <label className="visually-hidden" htmlFor={searchInputId}>
          Search themes
        </label>
        <input
          id={searchInputId}
          className="text-input"
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder="Search themes…  ( / )"
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

      {filtered.length === 0 ? (
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
          {filtered.map((theme, index) => {
            const isSelected = theme.slug === current.slug;
            const isActive = index === activeIndex;
            const classNames = ['theme-picker__option'];
            if (isActive) classNames.push('theme-picker__option--active');
            if (isSelected) classNames.push('theme-picker__option--selected');
            return (
              <li key={theme.slug} role="presentation">
                <button
                  type="button"
                  className={classNames.join(' ')}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => onSelect(theme)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span
                    className="theme-picker__swatch"
                    style={{
                      background: theme.tokens.bg,
                      borderColor: theme.tokens.accent,
                    }}
                    aria-hidden="true"
                  />
                  <span className="theme-picker__option-name">{theme.name}</span>
                  <span className={theme.isDark ? 'badge badge--dark' : 'badge badge--light'}>
                    {theme.isDark ? 'dark' : 'light'}
                  </span>
                  {theme.resumeSafe && (
                    <span className="badge badge--safe" title="Resume-safe">
                      ✓
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * ChromeModeToggle — a 3-state Auto / Light / Dark control for the APP
 * CHROME (the `--ui-*` shell), not the resume theme (#192).
 *
 * - `auto` (default) leaves <html> unmarked so the `prefers-color-scheme`
 *   media query in global.css governs — the chrome tracks the OS live with
 *   no JS and no flash.
 * - `light` / `dark` set `data-chrome-mode` on <html>, which the CSS layers
 *   over the media query to force a palette regardless of the OS.
 *
 * The choice persists via `storage.ts` (`womr:chrome-mode`). Because the OS
 * default is flash-free and forcing is opt-in, the mode is applied at
 * hydration rather than via a pre-paint inline script (see BaseLayout.astro
 * for why an inline script was not used).
 *
 * Rendered unconditionally by ResumeStudio so it's reachable on BOTH the
 * empty state and the loaded workbench. `data-print-hide` keeps it out of
 * the printed/exported output.
 *
 * CSP: applies the mode via `document.documentElement.dataset` (a DOM API),
 * never an inline `style=` — the same CSSOM pattern the theme engine uses.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon, { type IconName } from './Icon';
import { getStoredChromeMode, setStoredChromeMode, type ChromeMode } from '../utils/storage';

interface ModeOption {
  value: ChromeMode;
  label: string;
  icon: IconName;
}

const MODES: ModeOption[] = [
  { value: 'auto', label: 'Auto', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

/**
 * Apply a chrome mode to <html>. Forced modes set the attribute; `auto`
 * removes it so the prefers-color-scheme media query takes over.
 */
function applyChromeMode(mode: ChromeMode): void {
  const root = document.documentElement;
  if (mode === 'auto') {
    delete root.dataset.chromeMode;
  } else {
    root.dataset.chromeMode = mode;
  }
}

export default function ChromeModeToggle() {
  const groupRef = useRef<HTMLDivElement>(null);
  // SSR-safe: render the 'auto' default, then promote from storage on mount
  // (server has no localStorage — branching markup on it would desync
  // hydration). This mirrors every other persisted preference in the app.
  const [mode, setMode] = useState<ChromeMode>('auto');

  useEffect(() => {
    const stored = getStoredChromeMode() ?? 'auto';
    setMode(stored);
    // Forced modes weren't applied before hydration (no inline script), so
    // reconcile <html> with the stored choice now.
    applyChromeMode(stored);
  }, []);

  const select = useCallback((next: ChromeMode) => {
    setMode(next);
    setStoredChromeMode(next);
    // Arm the chrome cross-fade (#219) for THIS user toggle only — never on
    // first paint (the mount effect applies the mode without arming) and
    // never on a resume re-theme (that writes --resume-*, not --ui-*, and
    // doesn't pass through here). The CSS transition is scoped to
    // `:root.chrome-mode-anim`; we add the class, flip the attribute, then
    // drop the class after the transition. Skipped under reduced motion.
    const root = document.documentElement;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) {
      root.classList.add('chrome-mode-anim');
      window.setTimeout(() => root.classList.remove('chrome-mode-anim'), 280);
    }
    applyChromeMode(next);
  }, []);

  // Radiogroup roving-focus keyboard model: Arrow/Home/End move selection
  // AND focus together (WAI-ARIA radiogroup pattern).
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const current = MODES.findIndex((m) => m.value === mode);
      let nextIndex: number;
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          nextIndex = (current + 1) % MODES.length;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          nextIndex = (current - 1 + MODES.length) % MODES.length;
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = MODES.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      const next = MODES[nextIndex];
      select(next.value);
      groupRef.current
        ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
        ?.[nextIndex]?.focus();
    },
    [mode, select],
  );

  return (
    <div
      ref={groupRef}
      className="chrome-mode"
      role="radiogroup"
      aria-label="App appearance"
      data-print-hide
      onKeyDown={onKeyDown}
    >
      {MODES.map(({ value, label, icon }) => {
        const checked = mode === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={`${label} appearance`}
            tabIndex={checked ? 0 : -1}
            className={
              checked ? 'chrome-mode__option chrome-mode__option--active' : 'chrome-mode__option'
            }
            onClick={() => select(value)}
          >
            <Icon name={icon} size={14} />
            <span className="chrome-mode__label">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * KeyboardHelp — an accessible modal dialog listing every keyboard shortcut,
 * plus a master on/off toggle for the single-letter shortcuts (#58).
 *
 * Accessibility:
 *  - `role="dialog"` + `aria-modal="true"`, labelled by its heading.
 *  - Focus is trapped inside the dialog while open; Tab/Shift+Tab cycle.
 *  - Escape closes; focus is restored to the element that opened it.
 *  - On open, focus moves to the dialog's Close button.
 *
 * WCAG 2.1.4 (Character Key Shortcuts): the single-character shortcuts
 * (`r`, `p`, `e`, `?`) are mitigatable — the "Keyboard shortcuts" toggle
 * here turns them off. When disabled, only Escape keeps working. The
 * preference is persisted in localStorage under `womr:shortcuts-enabled`.
 */
import { useCallback, useEffect, useId, useRef } from 'react';
import Icon from './Icon';

/** Namespaced localStorage key for the shortcuts-enabled preference. */
const SHORTCUTS_KEY = 'womr:shortcuts-enabled';

/** Safely obtain `localStorage`, or `null` when unavailable (SSR / blocked). */
function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Read the persisted "keyboard shortcuts enabled" preference.
 * Defaults to `true` (enabled) when nothing is stored or storage is blocked.
 */
export function getStoredShortcutsEnabled(): boolean {
  const store = safeLocalStorage();
  if (!store) return true;
  try {
    // Only an explicit "0" disables shortcuts; anything else → enabled.
    return store.getItem(SHORTCUTS_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Persist the "keyboard shortcuts enabled" preference. Best-effort. */
export function setStoredShortcutsEnabled(enabled: boolean): void {
  const store = safeLocalStorage();
  if (!store) return;
  try {
    store.setItem(SHORTCUTS_KEY, enabled ? '1' : '0');
  } catch {
    /* no-op: persistence is best-effort only */
  }
}

/** One row of the shortcut reference: a key combo and what it does. */
interface ShortcutRow {
  /** Key glyphs to render as <kbd> elements. */
  keys: string[];
  /** Human description of the action. */
  label: string;
  /** True for single-character shortcuts gated by the master toggle. */
  characterKey?: boolean;
}

const SHORTCUTS: ShortcutRow[] = [
  { keys: ['←', '→'], label: 'Previous / next theme' },
  { keys: ['r'], label: 'Random theme', characterKey: true },
  { keys: ['/'], label: 'Search themes', characterKey: true },
  { keys: ['p'], label: 'Print / Save as PDF', characterKey: true },
  { keys: ['e'], label: 'Toggle the export panel', characterKey: true },
  { keys: ['?'], label: 'Open this shortcuts help', characterKey: true },
  { keys: ['Esc'], label: 'Close a panel or the active field' },
];

/** Selector matching every focusable element for the focus trap. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface KeyboardHelpProps {
  /** Whether the single-letter shortcuts are currently enabled. */
  shortcutsEnabled: boolean;
  /** Called when the user toggles the shortcuts-enabled preference. */
  onShortcutsEnabledChange: (enabled: boolean) => void;
  /** Request the dialog be closed. */
  onClose: () => void;
}

export default function KeyboardHelp({
  shortcutsEnabled,
  onShortcutsEnabledChange,
  onClose,
}: KeyboardHelpProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const descId = useId();
  const toggleId = useId();

  /* On open: move focus to the Close button so keyboard users land inside. */
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  /* Trap focus and handle Escape entirely within the dialog. */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !root.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  return (
    <div className="kbd-help__overlay" onPointerDown={onClose}>
      <div
        ref={dialogRef}
        className="kbd-help__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descId}
        onKeyDown={handleKeyDown}
        /* Clicks inside must not bubble to the overlay's dismiss handler. */
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="kbd-help__header">
          <h2 id={headingId} className="kbd-help__title">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            ref={closeButtonRef}
            className="btn btn--ghost btn--icon"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
          >
            <Icon name="close" />
          </button>
        </div>

        <p id={descId} className="kbd-help__intro">
          Shortcuts act on the resume preview. They are ignored while you type in the editor or a
          search field.
        </p>

        <dl className="kbd-help__list">
          {SHORTCUTS.map((row) => (
            <div className="kbd-help__row" key={row.label}>
              <dt className="kbd-help__keys">
                {row.keys.map((key, index) => (
                  <span key={key}>
                    {index > 0 && (
                      <span className="kbd-help__sep" aria-hidden="true">
                        {' '}
                      </span>
                    )}
                    <kbd>{key}</kbd>
                  </span>
                ))}
              </dt>
              <dd className="kbd-help__desc">{row.label}</dd>
            </div>
          ))}
        </dl>

        <div className="kbd-help__toggle">
          <label className="kbd-help__toggle-label" htmlFor={toggleId}>
            <input
              id={toggleId}
              type="checkbox"
              checked={shortcutsEnabled}
              onChange={(event) => onShortcutsEnabledChange(event.target.checked)}
            />
            <span>
              <span className="kbd-help__toggle-name">Single-key shortcuts enabled</span>
              <span className="kbd-help__toggle-hint">
                When off, only <kbd>Esc</kbd> works — single-letter keys (<kbd>r</kbd> <kbd>p</kbd>{' '}
                <kbd>e</kbd> <kbd>?</kbd>) and <kbd>/</kbd> are disabled. Arrow keys also pause.
                Saved on this device.
              </span>
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}

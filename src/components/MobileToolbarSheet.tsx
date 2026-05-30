/**
 * MobileToolbarSheet — left-anchored modal sheet that will host the toolbar
 * controls behind a single hamburger trigger on narrow viewports (#235).
 *
 * On phones the two-row toolbar (`Presets · Theme · Layout` / `Page-fit ·
 * Save as PDF · Export · ⚙`) collapses badly: chips wrap, tap targets shrink,
 * and the row stops reading as a toolbar. This sheet is the single surface
 * those controls will fold into — opened by a hamburger button, dismissed via
 * Esc / click-outside / explicit close. It is the mobile mirror of
 * `SettingsDrawer`, slid in from the left rather than the right.
 *
 * This is PR 1 of #235: a SCAFFOLD that ships dark. The shell — overlay,
 * dialog, focus management, close — is here, but the body is intentionally
 * empty (a placeholder comment) and the component is NOT mounted anywhere
 * yet. The control groups (Export, Page, Appearance, More) and the trigger
 * wiring land in later PRs.
 *
 * Accessibility
 * -------------
 * Mirrors `SettingsDrawer.tsx`:
 *   - `role="dialog"` + `aria-modal="true"` + `aria-labelledby` heading id.
 *   - Focus moves to the close button on open; focus trap on Tab/Shift+Tab.
 *   - Esc closes; click outside closes; explicit close button closes.
 *   - The caller restores focus to the hamburger button after close (parent
 *     owns the trigger ref, the sheet signals via `onClose`) — same contract
 *     ResumeStudio's other modals use.
 *
 * CSP
 * ---
 * No inline `style={...}` attributes. All visuals live in global.css under
 * `.mobile-sheet__*`.
 */
import { useCallback, useEffect, useId, useRef } from 'react';
import Icon from './Icon';

/** Selector matching every focusable element for the focus trap. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface MobileToolbarSheetProps {
  /** Whether the sheet is open. Renders nothing when false. */
  open: boolean;
  /** Request the sheet be closed (Esc, click-outside, close button). */
  onClose: () => void;
}

export default function MobileToolbarSheet({ open, onClose }: MobileToolbarSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();

  /* On open: move focus to the Close button so keyboard users land inside. */
  useEffect(() => {
    if (open) {
      closeButtonRef.current?.focus();
    }
  }, [open]);

  /* Trap focus + Escape entirely within the dialog. Same pattern as
     SettingsDrawer / KeyboardHelp / ExampleDialog so behavior across the
     modals is identical from the user's perspective. */
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

  if (!open) return null;

  return (
    <div
      className="mobile-sheet__overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={dialogRef}
        className="mobile-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        data-print-hide
        onKeyDown={handleKeyDown}
      >
        <header className="mobile-sheet__header">
          <h2 id={headingId} className="mobile-sheet__title">
            Toolbar
          </h2>
          <button
            type="button"
            ref={closeButtonRef}
            className="btn btn--ghost btn--icon"
            onClick={onClose}
            aria-label="Close toolbar menu"
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="mobile-sheet__body">
          {/* Groups (Export, Page, Appearance, More) added in #235 PR 2+. */}
        </div>
      </aside>
    </div>
  );
}

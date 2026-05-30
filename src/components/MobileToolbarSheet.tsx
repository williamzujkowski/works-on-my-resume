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
 * #235 PR 2 wires this in: the control groups (Export, Page, Appearance,
 * More) render as `children` and the hamburger trigger lives in the toolbar.
 * The sheet itself stays a thin modal shell — overlay, dialog, focus
 * management, close — so the caller composes the body.
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
 *   - Nested popovers (ExportPanel, the Page-fit popover) host their own
 *     focus-trap + Escape + outside-click. When focus is inside one of them
 *     the sheet DEFERS its own Escape / outside-click so the inner overlay
 *     closes first — the same guard SettingsDrawer uses for SnapshotsMenu.
 *
 * CSP
 * ---
 * No inline `style={...}` attributes. All visuals live in global.css under
 * `.mobile-sheet__*`.
 */
import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import Icon from './Icon';

/** Selector matching every focusable element for the focus trap. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Selector for the nested overlays the sheet must defer to on Escape /
 * outside-click. Each owns its own focus-trap + dismissal; closing the
 * sheet wholesale would feel like the dismissal skipped a level.
 */
const NESTED_POPOVER_SELECTOR = '.export-panel__dialog, .page-fit__popover';

interface MobileToolbarSheetProps {
  /** Whether the sheet is open. Renders nothing when false. */
  open: boolean;
  /** Request the sheet be closed (Esc, click-outside, close button). */
  onClose: () => void;
  /** The control groups (Export, Page, Appearance, More) rendered in the body. */
  children: ReactNode;
}

export default function MobileToolbarSheet({ open, onClose, children }: MobileToolbarSheetProps) {
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
        // The Export panel and the Page-fit popover each own an Escape
        // handler (a document-level listener) that closes themselves and
        // restore focus to their trigger inside the sheet. While one is open,
        // defer — closing the sheet wholesale would feel like Esc skipped a
        // level. Detect by PRESENCE in the sheet's subtree, not by focus: the
        // Page-fit popover leaves focus on its trigger (a sibling of the
        // popover), so an activeElement.closest() check would miss it. This
        // React handler bubbles BEFORE the popovers' document listeners, so
        // the popover is still mounted here when its own Esc is about to fire.
        const root = dialogRef.current;
        if (root && root.querySelector(NESTED_POPOVER_SELECTOR)) {
          return;
        }
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
        // A nested popover (Export panel / Page-fit) renders as a full-width
        // bottom sheet layered ABOVE this overlay on mobile. While one is open,
        // defer so its OWN outside-click handler closes it, not the whole
        // sheet. Detect by presence (the Page-fit popover keeps focus on its
        // trigger, so a focus check would miss it).
        if (event.target !== event.currentTarget) return;
        if (dialogRef.current?.querySelector(NESTED_POPOVER_SELECTOR)) return;
        onClose();
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

        <div className="mobile-sheet__body">{children}</div>
      </aside>
    </div>
  );
}

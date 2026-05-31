/**
 * usePopover — shared dismiss / focus plumbing for the app's NON-MODAL
 * popovers (#202).
 *
 * Four toolbar popovers (Export, Snapshots, Page-fit, Theme picker) each
 * grew their own copy of the same three concerns:
 *
 *   1. Escape closes the popover.
 *   2. A pointer-down outside the popover (and its trigger) closes it.
 *   3. Closing restores focus to the trigger that opened it.
 *
 * They diverged in subtle, bug-prone ways — most importantly in WHERE the
 * Escape listener lived. #207 established the correct pattern: scope Escape
 * to the popover ELEMENT (a React `onKeyDown` that calls `stopPropagation`)
 * rather than to `document`. That matters because two of these popovers
 * render INSIDE a modal host (`SettingsDrawer`, `MobileToolbarSheet`) whose
 * own Escape / outside-click must DEFER to the inner popover so the inner
 * one closes first. A document-level Escape listener is a sibling of the
 * host's React keydown handler, so `stopPropagation` there cannot reliably
 * stop the host from also closing; an element-scoped handler sits on the
 * React bubbling path INTO the host, so `stopPropagation` genuinely halts
 * the host's handler. This hook bakes that pattern in for all four.
 *
 * NON-MODAL only: no focus trap, no `aria-modal="true"`, no scroll lock.
 * Callers keep all of their UNIQUE behavior (ThemePicker's roving listbox +
 * search + hover-preview-revert, PageFit's ruler portal + steppers, the
 * Export download grid, the Snapshots list). The hook moves ONLY the
 * dismiss/focus plumbing.
 *
 * No new dependencies, no inline `style={...}` — consistent with the rest of
 * `src/`.
 */
import { useCallback, useEffect, useRef, type RefObject } from 'react';

export interface UsePopoverOptions {
  /** Whether the popover is currently open. Drives the listeners + restore. */
  open: boolean;
  /** Request the popover be closed (set the caller's open state to false). */
  onClose: () => void;
  /**
   * The element that scopes "inside" for the outside-click check. A
   * pointer-down whose target is contained by this element never closes the
   * popover. Pass the OUTERMOST element that should count as inside — for the
   * single-root popovers (Page-fit, Theme picker) this is the wrapper that
   * holds BOTH the trigger and the popover, so clicking the trigger or a
   * sibling control inside the wrapper does not self-close.
   */
  containerRef: RefObject<HTMLElement | null>;
  /**
   * The trigger button. Used for two things: (1) it is always treated as
   * "inside" for the outside-click check (so the trigger's own toggle owns
   * the close, never the document listener), and (2) focus is restored here
   * when the popover transitions from open → closed.
   *
   * Optional because a caller may fold the trigger into `containerRef` (it is
   * then covered by the container's `contains` check) AND restore focus
   * itself — but passing it lets the hook own focus-restore centrally.
   */
  triggerRef?: RefObject<HTMLButtonElement | null>;
  /**
   * Extra elements (resolved lazily on each pointer-down) that should ALSO
   * count as "inside" — i.e. a pointer-down on one of them must NOT close the
   * popover. Used for DOM that lives OUTSIDE `containerRef` but is logically
   * part of the popover, e.g. a portalled overlay. Return `null` for an entry
   * that is not currently mounted.
   *
   * Conversely, to make a region OUTSIDE the container close the popover even
   * though it visually overlaps (PageFit's ruler portal), simply do NOT list
   * it here — it then reads as "outside" and a pointer-down closes, which is
   * the historical behavior we preserve.
   */
  getExtraInside?: () => ReadonlyArray<HTMLElement | null>;
  /**
   * Focus restoration policy. The Escape path ALWAYS restores focus to the
   * trigger (a keyboard user must never be stranded). This option controls
   * restoration for the OTHER close paths (outside-click, an explicit close
   * button, a list selection), where the historical behavior differs per
   * popover:
   *
   *   - `'escape'` (default): restore ONLY on Escape. Outside-click leaves
   *     focus where the pointer landed; explicit-close / selection callers
   *     call `restoreFocus()` themselves at the exact moment they want it.
   *     Matches Snapshots / Page-fit / Theme-picker.
   *   - `'unmount'`: ALSO restore when the popover unmounts. For a popover
   *     that is mounted only while open (Export), unmount === close, so this
   *     restores focus on every close path including outside-click — matching
   *     Export's historical unmount-cleanup restore.
   */
  restoreFocus?: 'escape' | 'unmount';
}

export interface UsePopover {
  /**
   * Spread onto the popover ELEMENT (the rendered dialog `div`). Provides the
   * element-scoped Escape handler — `stopPropagation()` then `onClose()` — so
   * a host modal's own Escape defers to this popover (#207).
   */
  popoverProps: {
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  };
  /**
   * Imperatively restore focus to the trigger. Exposed for callers that opt
   * out of automatic restore, or that close from a path (a list selection,
   * an explicit close button) where they want to restore at a precise moment.
   */
  restoreFocus: () => void;
}

/**
 * Wire the common dismiss / focus behavior for a non-modal popover.
 *
 * The Escape handler is RETURNED (as `popoverProps.onKeyDown`) rather than
 * attached to `document`, so it stays on the React bubbling path into any
 * host modal — see the module comment.
 */
export function usePopover({
  open,
  onClose,
  containerRef,
  triggerRef,
  getExtraInside,
  restoreFocus: restorePolicy = 'escape',
}: UsePopoverOptions): UsePopover {
  const restoreFocus = useCallback(() => {
    triggerRef?.current?.focus();
  }, [triggerRef]);

  /* Element-scoped Escape (#207). `stopPropagation` keeps the keydown from
     bubbling to a host drawer/sheet's own Escape handler, so the inner
     popover closes first and the host stays open until a second Escape.
     Escape always restores focus to the trigger so a keyboard user is never
     stranded — regardless of the `restoreFocus` policy, which governs only
     the non-Escape close paths. */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      // Guard on `open` so a caller that attaches this to an ALWAYS-mounted
      // wrapper (Page-fit's chip holds the trigger + popover, and the trigger
      // — not the popover — is where focus sits while open) does not swallow
      // Escape when the popover is CLOSED. If it did, an Escape on the focused
      // trigger inside a host sheet would be `stopPropagation`'d and never
      // reach the sheet. Only act while open.
      if (!open) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        restoreFocus();
      }
    },
    [open, onClose, restoreFocus],
  );

  /* Outside-click dismissal on a document `pointerdown`. A target inside the
     container, the trigger, or any caller-supplied extra-inside element is
     exempt; everything else closes. Listener is only attached while open. */
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (triggerRef?.current?.contains(target)) return;
      const extra = getExtraInside?.() ?? [];
      for (const el of extra) {
        if (el?.contains(target)) return;
      }
      onClose();
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
    // `getExtraInside` is read fresh inside the handler, so a stable ref to it
    // is enough; callers pass an inline arrow that closes over current state.
  }, [open, onClose, containerRef, triggerRef, getExtraInside]);

  /* `'unmount'` policy: restore focus to the trigger when this hook unmounts.
     The Export panel is mounted only while open, so its unmount IS its close —
     this reproduces its historical unmount-cleanup focus restore, which fires
     on every close path (Escape, the close button, AND outside-click). We
     read the latest `restoreFocus` via a ref so the cleanup runs exactly once
     on unmount rather than on every `triggerRef` identity change. */
  const restoreFocusRef = useRef(restoreFocus);
  restoreFocusRef.current = restoreFocus;
  useEffect(() => {
    if (restorePolicy !== 'unmount') return;
    return () => {
      restoreFocusRef.current();
    };
  }, [restorePolicy]);

  return {
    popoverProps: { onKeyDown },
    restoreFocus,
  };
}

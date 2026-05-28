/**
 * Toast — a small dismissible visual notice for overwrite events (#77).
 *
 * Companion to the polite aria-live region in ResumeStudio. #69 added the
 * "Saved draft replaced — N lines from <source>" announcement for screen
 * readers; sighted users had no equivalent feedback when their saved draft
 * was overwritten by a file load. This toast closes that loop: it appears
 * briefly in the corner of the viewport, mirroring the announcement text,
 * with a manual dismiss affordance.
 *
 * Accessibility:
 *  - This component is INTENTIONALLY NOT a live region. No role="status",
 *    no aria-live. The screen-reader path is owned by the existing
 *    aria-live region in ResumeStudio — duplicating it here would make AT
 *    users hear the same line twice. The toast is purely a visual cue.
 *  - The close button is a real focusable <button> with an aria-label.
 *  - The "replaced" cue is text, not color — color is only a tint.
 *
 * Motion:
 *  - Under prefers-reduced-motion the entrance fade is suppressed and the
 *    timed dismissal removes the toast instantly rather than fading out.
 *  - Pointer/keyboard focus pauses the auto-dismiss timer so a user who is
 *    reading or about to click "dismiss" doesn't have the toast yanked.
 *
 * Stacking is deliberately one-at-a-time: a second overwrite replaces the
 * first toast. Implemented by passing a new `id` prop on each event so the
 * `useEffect` resets the timer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';

/** How long the toast stays on screen before auto-dismissing. */
const AUTO_DISMISS_MS = 5000;

interface ToastProps {
  /** Unique id per event — changing it resets the auto-dismiss timer. */
  id: number;
  /** The visible message. */
  message: string;
  /** Called when the toast should be removed (timer or close button). */
  onDismiss: () => void;
}

/** True when the user has NOT asked for reduced motion. */
function motionOk(): boolean {
  try {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

export default function Toast({ id, message, onDismiss }: ToastProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [paused, setPaused] = useState(false);

  /** Schedule auto-dismissal, honoring pause-on-hover/focus. */
  useEffect(() => {
    if (paused) return;
    const handle = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(handle);
    // `id` participates so each new event restarts the timer.
  }, [id, paused, onDismiss]);

  /** Allow Escape to dismiss when focus is on the close button. */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onDismiss();
      }
    },
    [onDismiss],
  );

  // Reduced-motion users get a class that disables the entrance animation.
  // Determined at render time — there is no SSR for this component since
  // ResumeStudio is a client island and the toast only ever mounts after
  // user interaction.
  const reduced = !motionOk();

  return (
    <div
      className={`toast${reduced ? ' toast--reduced' : ''}`}
      data-print-hide
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={handleKeyDown}
    >
      <Icon name="replace" size={16} className="toast__icon" />
      <span className="toast__message">{message}</span>
      <button
        ref={closeRef}
        type="button"
        className="toast__close"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

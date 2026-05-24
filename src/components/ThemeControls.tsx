/**
 * ThemeControls — previous / next / random theme buttons.
 *
 * Originally also hosted the dark/light + WCAG contrast chips and the
 * "Copy theme link" button, but #112 collapsed those out of the toolbar:
 *   - The WCAG badge is now shown ONCE, in the preview pane header (#88),
 *     so the user has a single canonical conformance signal rather than
 *     two competing ones.
 *   - "Copy theme link" moved into the Export popover, where it sits
 *     alongside the other "give someone a copy of this look" actions —
 *     it was always a low-frequency control and didn't deserve toolbar
 *     real estate.
 *
 * What's left is the segmented prev / next / random cluster — the rapid-
 * fire stepping affordance that pairs with the ← / → / r keyboard
 * shortcuts.
 */
import type { ResumeTheme } from '../types';
import Icon from './Icon';

interface ThemeControlsProps {
  current: ResumeTheme;
  onPrevious: () => void;
  onNext: () => void;
  onRandom: () => void;
}

export default function ThemeControls({
  // current is unused now that the chips have been removed (#112), but the
  // prop stays so callers don't lose the contract — and so a future
  // re-introduction of a per-theme affordance can land without a churned API.
  current: _current,
  onPrevious,
  onNext,
  onRandom,
}: ThemeControlsProps) {
  return (
    <div className="theme-controls">
      <div className="theme-controls__nav" role="group" aria-label="Step through themes">
        <button
          type="button"
          className="btn btn--icon"
          onClick={onPrevious}
          aria-label="Previous theme"
          title="Previous theme (←)"
        >
          <Icon name="chevron-left" />
        </button>
        <button
          type="button"
          className="btn btn--icon"
          onClick={onNext}
          aria-label="Next theme"
          title="Next theme (→)"
        >
          <Icon name="chevron-right" />
        </button>
        <button
          type="button"
          className="btn btn--icon"
          onClick={onRandom}
          aria-label="Random theme"
          title="Random theme (r)"
        >
          <Icon name="shuffle" />
        </button>
      </div>
    </div>
  );
}

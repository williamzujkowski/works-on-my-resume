/**
 * AtsModeToggle — flip the preview into "ATS mode" (#31).
 *
 * Renders a labeled switch in the toolbar. When pressed, the preview wrapper
 * picks up `data-mode="ats"` and `resume.css` overrides the theme to a
 * monochrome, single-column rendering — approximately what an Applicant
 * Tracking System parser would see.
 *
 * Accessibility:
 *  - Uses an `<input type="checkbox" role="switch">` so the control is a
 *    standard toggle (keyboard-operable, screen-reader announces "switch,
 *    on/off"). The label is visible and clickable.
 *  - When ATS mode is on, the legend below the toggle quietly notes that
 *    theme switching has no effect — color signalling is not the only cue.
 *
 * Persistence is sessionStorage: a viewing mode, not a long-term preference.
 */
import { useId } from 'react';

interface AtsModeToggleProps {
  /** True when ATS preview is currently active. */
  active: boolean;
  /** Toggle on/off. */
  onChange: (active: boolean) => void;
}

export default function AtsModeToggle({ active, onChange }: AtsModeToggleProps) {
  const id = useId();
  return (
    <div className="ats-toggle">
      <label className="ats-toggle__label" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={active}
          onChange={(event) => onChange(event.target.checked)}
          className="ats-toggle__input"
          aria-describedby={`${id}-hint`}
        />
        <span className="ats-toggle__name">ATS preview</span>
      </label>
      <span id={`${id}-hint`} className="ats-toggle__hint">
        {active
          ? 'Showing the plain-text, single-column view. Theme is muted.'
          : 'Show what an ATS parser approximately sees.'}
      </span>
    </div>
  );
}

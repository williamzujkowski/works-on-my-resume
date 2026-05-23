/**
 * LayoutSelector — segmented control for picking a resume layout template (#30).
 *
 * Three layouts live in `resume.css` as `[data-template]` overlays:
 *   - Classic (default — Source Serif 4 body, the existing rhythm).
 *   - Modern  (mono section labels, larger identity, quieter dividers).
 *   - Compact (tighter rhythm, smaller headings, for one-page resumes).
 *
 * Implemented as native radio inputs inside a `<fieldset>` so it is keyboard
 * operable for free (arrow-keys move between the three radios, Space/Enter
 * commits) and announces correctly to assistive tech without any ARIA
 * gymnastics. The visible label sits on the legend; the radios themselves
 * are visually hidden, and the buttons are the styled `<label>` siblings.
 *
 * Disabled when no resume is loaded (the picker has nothing to apply to)
 * via the parent — this component just renders what it is told.
 */
import type { ResumeTemplate, ResumeTemplateInfo } from '../types';

interface LayoutSelectorProps {
  /** All available templates, in the order they should be rendered. */
  templates: readonly ResumeTemplateInfo[];
  /** Currently active template slug. */
  current: ResumeTemplate;
  /** Commit a new template choice. */
  onChange: (template: ResumeTemplate) => void;
}

export default function LayoutSelector({ templates, current, onChange }: LayoutSelectorProps) {
  return (
    <fieldset
      className="layout-selector"
      aria-label="Layout"
      /* The visible legend label below carries the same name; the
         `aria-label` here is a belt-and-suspenders for VoiceOver, which
         occasionally treats a `<legend>` inside a flex container as
         decoration. */
    >
      <legend className="layout-selector__legend">Layout</legend>
      <div className="layout-selector__options" role="presentation">
        {templates.map((template) => {
          const id = `layout-${template.slug}`;
          const checked = current === template.slug;
          return (
            <label
              key={template.slug}
              className={
                checked
                  ? 'layout-selector__option layout-selector__option--active'
                  : 'layout-selector__option'
              }
              htmlFor={id}
              title={template.description}
            >
              <input
                id={id}
                type="radio"
                name="resume-layout"
                value={template.slug}
                checked={checked}
                onChange={() => onChange(template.slug)}
                className="layout-selector__input"
              />
              <span className="layout-selector__option-label">{template.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

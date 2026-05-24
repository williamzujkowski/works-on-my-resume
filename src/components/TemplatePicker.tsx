/**
 * TemplatePicker — modal dialog that lets the user start a new resume
 * from one of four pre-built stage-specific templates (#86).
 *
 * Behaviour mirrors `KeyboardHelp.tsx`:
 *  - `role="dialog"` + `aria-modal="true"`, labelled by its heading.
 *  - Focus is trapped while open; Tab and Shift+Tab cycle within the dialog.
 *  - Escape closes; focus restoration to the opener is the caller's job
 *    (the integration agent owns the trigger ref in `MarkdownUploader`).
 *  - On open, focus moves to the Close button so keyboard users land
 *    inside the dialog.
 *
 * The component is purely presentational with respect to the template
 * content: it knows the four slugs and their human-readable framing,
 * but it does NOT fetch any Markdown. Selection is reported upstream via
 * `onSelect(slug)`; the integration agent wires that callback through
 * `MarkdownUploader` so the picked template flows through the same fetch
 * path as "Load sample".
 */
import { useCallback, useEffect, useId, useRef } from 'react';
import Icon from './Icon';

/** Stable slug identifying which template the user picked. */
export type TemplateSlug = 'junior' | 'mid' | 'senior' | 'em';

/** A single card in the picker grid. */
interface TemplateOption {
  slug: TemplateSlug;
  /** Bold card title — the role-stage shorthand. */
  title: string;
  /** One-line description of what the template emphasizes. */
  description: string;
}

const TEMPLATES: TemplateOption[] = [
  {
    slug: 'junior',
    title: 'Junior IC',
    description:
      'Recent graduate or early career. Leads with education and a portfolio of projects; internships round it out.',
  },
  {
    slug: 'mid',
    title: 'Mid IC',
    description:
      'Two to six years in. Leads with a short summary and quantified experience; education sits at the bottom.',
  },
  {
    slug: 'senior',
    title: 'Senior IC',
    description:
      'Staff-track or principal engineer. A Selected Impact section frames the headline outcomes before the role history.',
  },
  {
    slug: 'em',
    title: 'Engineering Manager',
    description:
      'For people-leaders. Includes a Leadership Highlights section and a Teams Built / Operating Model breakdown.',
  },
];

/** Selector matching every focusable element for the focus trap. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface TemplatePickerProps {
  /** Whether the dialog is currently mounted. The caller controls this. */
  open: boolean;
  /** Request the dialog be closed (Escape, Close button, or overlay click). */
  onClose: () => void;
  /** Called with the picked template slug. The caller handles the fetch. */
  onSelect: (slug: TemplateSlug) => void;
}

export default function TemplatePicker({ open, onClose, onSelect }: TemplatePickerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const descId = useId();

  /* On open: move focus to the Close button so keyboard users land inside
     the dialog (matching the KeyboardHelp pattern). */
  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
  }, [open]);

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

  if (!open) return null;

  return (
    <div className="template-picker__overlay" onPointerDown={onClose}>
      <div
        ref={dialogRef}
        className="template-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descId}
        onKeyDown={handleKeyDown}
        /* Clicks inside must not bubble to the overlay's dismiss handler. */
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="template-picker__header">
          <h2 id={headingId} className="template-picker__title">
            Start from a template
          </h2>
          <button
            type="button"
            ref={closeButtonRef}
            className="btn btn--ghost btn--icon template-picker__close"
            onClick={onClose}
            aria-label="Close template picker"
          >
            <Icon name="close" />
          </button>
        </div>

        <p id={descId} className="template-picker__intro">
          Pick a starting point. Each template is a complete, well-structured Markdown resume — edit
          it in place to make it yours. Nothing is uploaded.
        </p>

        <ul className="template-picker__grid" role="list">
          {TEMPLATES.map((template) => (
            <li key={template.slug} className="template-picker__card">
              <h3 className="template-picker__card-title">{template.title}</h3>
              <p className="template-picker__card-desc">{template.description}</p>
              <button
                type="button"
                className="btn btn--primary template-picker__card-action"
                onClick={() => onSelect(template.slug)}
              >
                Use this template
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

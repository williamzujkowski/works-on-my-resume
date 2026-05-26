/**
 * TemplatePicker — modal dialog that lets the user start a new resume
 * from one of five pre-built starting points (#86, #156).
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
 * content: it knows the five slugs and their human-readable framing,
 * but it does NOT fetch any Markdown. Selection is reported upstream via
 * `onSelect(slug)`; the integration agent wires that callback through
 * `MarkdownUploader` so the picked template flows through the same fetch
 * path as "Load sample".
 *
 * The fifth template — `scaffold` — is a placeholder-only skeleton meant
 * for hand-fill OR LLM hand-off (#156). Its card carries a secondary
 * "Copy to LLM" action that fetches the raw scaffold markdown and copies
 * a prompt-ready paste (intro prompt + the scaffold body) to the
 * clipboard. That's the only card with the secondary action; the four
 * worked-example templates are self-contained.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon';

/** Stable slug identifying which template the user picked. */
export type TemplateSlug = 'junior' | 'mid' | 'senior' | 'em' | 'scaffold';

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
  {
    slug: 'scaffold',
    title: 'Scaffold',
    description: 'Empty skeleton with placeholders — fill it in or feed to an LLM.',
  },
];

/** The slug whose card surfaces the secondary "Copy to LLM" action (#156). */
const LLM_COPY_SLUG: TemplateSlug = 'scaffold';

/** Prompt prepended to the scaffold body when "Copy to LLM" is clicked. */
const LLM_COPY_PROMPT =
  'Fill this resume scaffold from the information below. Keep the structure exact (do not change frontmatter keys or section headings). Replace every <<...>> placeholder with my information:';

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

  /* "Copy to LLM" confirmation pip — same UX as the Export panel's
     "Copy theme link" affordance: a transient `Copied` indicator that
     auto-clears after 2 s. Scoped to a single card so we only need one
     boolean here. The timer ref lets us clear on unmount and on rapid
     re-clicks. */
  const [llmCopied, setLlmCopied] = useState(false);
  const llmCopyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (llmCopyTimer.current) clearTimeout(llmCopyTimer.current);
    };
  }, []);

  /* When the dialog closes, drop any lingering "Copied" confirmation so
     the next open doesn't flash a stale pip. */
  useEffect(() => {
    if (open) return;
    setLlmCopied(false);
    if (llmCopyTimer.current) {
      clearTimeout(llmCopyTimer.current);
      llmCopyTimer.current = null;
    }
  }, [open]);

  /* Fetch the scaffold markdown, prepend the LLM-prompt intro, and copy
     the result to the clipboard. Same fetch path as `handleTemplateSelect`
     in MarkdownUploader so the BASE_URL handling stays consistent. */
  const copyScaffoldToClipboard = useCallback(async () => {
    try {
      const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
      const response = await fetch(`${base}templates/scaffold.md`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      const payload = `${LLM_COPY_PROMPT}\n\n${body}`;
      await navigator.clipboard.writeText(payload);
      setLlmCopied(true);
      if (llmCopyTimer.current) clearTimeout(llmCopyTimer.current);
      llmCopyTimer.current = setTimeout(() => setLlmCopied(false), 2000);
    } catch {
      /* Clipboard or fetch failed — fall back to a prompt so a user with
         a denied clipboard permission can still copy by hand. Mirrors the
         degraded path in ExportPanel.copyThemeLink. */
      try {
        const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
        const response = await fetch(`${base}templates/scaffold.md`);
        const body = response.ok ? await response.text() : '';
        window.prompt('Copy this prompt + scaffold:', `${LLM_COPY_PROMPT}\n\n${body}`);
      } catch {
        /* Nothing more to do — the picker stays open so the user can
           still pick "Use this template" and copy from the editor. */
      }
    }
  }, []);

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
              {template.slug === LLM_COPY_SLUG && (
                <div className="template-picker__card-secondary">
                  <button
                    type="button"
                    className="btn template-picker__card-action"
                    onClick={copyScaffoldToClipboard}
                  >
                    Copy to LLM
                  </button>
                  {llmCopied && (
                    <span className="template-picker__copied" role="status">
                      <Icon name="check" size={13} /> Copied
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

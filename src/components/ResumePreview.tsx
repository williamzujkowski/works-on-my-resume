/**
 * ResumePreview — renders the parsed resume document.
 *
 * The HTML it injects via `dangerouslySetInnerHTML` is the `parsed.html`
 * field from `parseResume`, which is ALREADY SANITIZED by DOMPurify in
 * markdown.ts (the trust boundary). This component performs no sanitizing
 * of its own — it is purely a presentation layer.
 *
 * It keeps the exact `resume-preview` class so `resume.css` can target it,
 * optionally renders a compact contact line from frontmatter, surfaces any
 * non-fatal parser warnings, and shows a friendly empty state.
 */
import type { ParsedResume } from '../types';

interface ResumePreviewProps {
  /** Parsed resume, or null when nothing has been loaded yet. */
  parsed: ParsedResume | null;
}

export default function ResumePreview({ parsed }: ResumePreviewProps) {
  if (!parsed) {
    return (
      <div className="preview-frame">
        <div className="preview-empty">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6M9 13h6M9 17h4" />
          </svg>
          <p className="preview-empty__title">No resume loaded yet</p>
          <p>
            Upload a Markdown file, paste your resume into the editor, or load the sample to see it
            rendered here.
          </p>
        </div>
      </div>
    );
  }

  const { frontmatter, html, warnings } = parsed;
  const { name, role, location, email, phone, links } = frontmatter;
  const hasContact = Boolean(
    name || role || location || email || phone || (links && links.length > 0),
  );

  /** Build the metadata items for the contact line, joined by separators. */
  const metaItems: React.ReactNode[] = [];
  if (location) metaItems.push(<span key="loc">{location}</span>);
  if (email) {
    metaItems.push(
      <a key="email" href={`mailto:${email}`}>
        {email}
      </a>,
    );
  }
  if (phone) metaItems.push(<span key="phone">{phone}</span>);
  if (links) {
    for (const link of links) {
      metaItems.push(
        <a key={`link-${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer">
          {link.label}
        </a>,
      );
    }
  }

  return (
    <div className="preview-frame">
      <article className="resume-preview" aria-label="Rendered resume">
        {warnings.length > 0 && (
          <div className="preview-warnings" role="status" data-print-hide>
            <strong>Heads up — the parser noted:</strong>
            <ul>
              {warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        {hasContact && (
          <header className="resume-preview__contact">
            {name && <p className="resume-preview__contact-name">{name}</p>}
            {role && <p className="resume-preview__contact-role">{role}</p>}
            {metaItems.length > 0 && (
              <p className="resume-preview__contact-meta">
                {metaItems.map((item, index) => (
                  <span key={index} style={{ display: 'contents' }}>
                    {index > 0 && (
                      <span className="resume-preview__contact-sep" aria-hidden="true">
                        ·
                      </span>
                    )}
                    {item}
                  </span>
                ))}
              </p>
            )}
          </header>
        )}

        {/* `html` is sanitized by parseResume() in src/utils/markdown.ts
            (gray-matter -> marked -> DOMPurify) before it reaches here. */}
        <div className="resume-preview__body" dangerouslySetInnerHTML={{ __html: html }} />
      </article>
    </div>
  );
}

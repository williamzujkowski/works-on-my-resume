/**
 * ResumePreview — renders the parsed resume document.
 *
 * The HTML it injects via `dangerouslySetInnerHTML` is the `parsed.html`
 * field from `parseResume`, which is ALREADY SANITIZED by DOMPurify in
 * markdown.ts (the trust boundary). This component performs no sanitizing
 * of its own — it is purely a presentation layer.
 *
 * It keeps the exact `resume-preview` class so `resume.css` can target it,
 * renders a canonical identity header from frontmatter, surfaces any
 * non-fatal parser warnings, and shows a friendly empty state.
 *
 * Identity de-duplication (#50): when frontmatter supplies a name, the
 * frontmatter-derived contact header is the canonical identity. A body that
 * still opens with its own `# Name` (and an optional role paragraph) would
 * print the name twice — so a leading body `<h1>` is dropped, tastefully,
 * before injection. The shipped sample resume already keeps its body
 * content-only; this guard simply makes user resumes forgiving.
 */
import { useMemo } from 'react';
import type { ParsedResume } from '../types';
import Icon from './Icon';

interface ResumePreviewProps {
  /** Parsed resume, or null when nothing has been loaded yet. */
  parsed: ParsedResume | null;
}

/**
 * Strip a leading `<h1>` (and an immediately-following short paragraph that
 * reads as a role/tagline line) from already-sanitized body HTML, but only
 * when a frontmatter identity header is being rendered above it. Operates on
 * a detached DOM fragment so it never mutates anything live.
 */
function dedupeIdentity(html: string): string {
  if (typeof document === 'undefined') return html;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;

  // Find the first element node.
  const first = tpl.content.firstElementChild;
  if (!first || first.tagName !== 'H1') return html;

  // Drop a role/tagline paragraph that immediately follows the name heading,
  // but only if it is short enough to plausibly be a subtitle (not a summary).
  const next = first.nextElementSibling;
  first.remove();
  if (next && next.tagName === 'P' && (next.textContent ?? '').trim().length <= 90) {
    next.remove();
  }

  // Collapse any whitespace-only text node now leading the fragment.
  while (
    tpl.content.firstChild &&
    tpl.content.firstChild.nodeType === Node.TEXT_NODE &&
    !(tpl.content.firstChild.textContent ?? '').trim()
  ) {
    tpl.content.firstChild.remove();
  }

  // Re-serialize.
  const wrapper = document.createElement('div');
  wrapper.appendChild(tpl.content.cloneNode(true));
  return wrapper.innerHTML;
}

export default function ResumePreview({ parsed }: ResumePreviewProps) {
  const { name, role, location, email, phone, links } = parsed?.frontmatter ?? {};
  const hasContact = Boolean(
    name || role || location || email || phone || (links && links.length > 0),
  );

  // De-duplicate only when there is a canonical frontmatter identity header.
  const bodyHtml = useMemo(() => {
    if (!parsed) return '';
    return hasContact ? dedupeIdentity(parsed.html) : parsed.html;
  }, [parsed, hasContact]);

  if (!parsed) {
    return (
      <div className="preview-frame">
        <div className="preview-empty">
          <span className="preview-empty__icon" aria-hidden="true">
            <Icon name="file" size={36} />
          </span>
          <p className="preview-empty__title">No resume loaded yet</p>
          <p>
            Upload a Markdown file, paste your resume into the editor, or load the sample to see it
            rendered here.
          </p>
        </div>
      </div>
    );
  }

  const { warnings } = parsed;

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

        {/* `bodyHtml` derives from parsed.html, which is sanitized by
            parseResume() in src/utils/markdown.ts (gray-matter -> marked ->
            DOMPurify). The dedupe pass only removes nodes — never adds. */}
        <div className="resume-preview__body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      </article>
    </div>
  );
}

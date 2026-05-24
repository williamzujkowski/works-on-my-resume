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
 *
 * Faded sample preview (#96): the `parsed === null` empty state is no
 * longer a static card. We fetch the bundled `public/sample-resume.md` on
 * mount, parse it the same way a real upload would, and render it at
 * ~0.55 opacity behind a non-blocking overlay (icon, headline, "Try the
 * sample" button). The overlay's pointer-events: none lets the button stay
 * clickable; the button routes through the same `onLoad` path the uploader
 * uses so loading the faded sample is indistinguishable from a real upload.
 * If the fetch fails the static empty state is the graceful fallback.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ParsedResume, PreviewMode, ResumeTemplate } from '../types';
import { DEFAULT_RESUME_TEMPLATE } from '../types';
import { parseResume } from '../utils/markdown';
import Icon from './Icon';

interface ResumePreviewProps {
  /** Parsed resume, or null when nothing has been loaded yet. */
  parsed: ParsedResume | null;
  /**
   * Active layout template (#30). Reflected onto the article as
   * `data-template="<slug>"` so `resume.css`'s template overlays apply.
   * Defaults to `classic`.
   */
  template?: ResumeTemplate;
  /**
   * Preview rendering mode (#31). `ats` overrides theme/template visuals
   * with a monochrome, single-column rendering. Defaults to `normal`.
   */
  mode?: PreviewMode;
  /**
   * Faded-sample CTA (#96). When provided, the empty state can offer a
   * "Try the sample" button that routes through this callback — same path
   * as MarkdownUploader's "Load sample". Omitting it falls back to the
   * static empty state.
   */
  onLoadSample?: (text: string, sourceName: string) => void;
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

export default function ResumePreview({
  parsed,
  template = DEFAULT_RESUME_TEMPLATE,
  mode = 'normal',
  onLoadSample,
}: ResumePreviewProps) {
  const { name, role, location, email, phone, links } = parsed?.frontmatter ?? {};
  const hasContact = Boolean(
    name || role || location || email || phone || (links && links.length > 0),
  );

  // De-duplicate only when there is a canonical frontmatter identity header.
  const bodyHtml = useMemo(() => {
    if (!parsed) return '';
    return hasContact ? dedupeIdentity(parsed.html) : parsed.html;
  }, [parsed, hasContact]);

  /* ----- Faded sample preview state (#96) -----
     `sampleText` is the raw Markdown we fetched (kept so the CTA can pass
     it straight to onLoad — no second fetch). `sampleParsed` is the parsed
     render-ready version. Both are null until the fetch succeeds; if it
     fails we leave them null and fall back to the static empty state. The
     fetch runs only while the empty state is in view. */
  const [sampleText, setSampleText] = useState<string | null>(null);
  const [sampleParsed, setSampleParsed] = useState<ParsedResume | null>(null);
  useEffect(() => {
    // Only fetch when we are actually showing the empty state AND a CTA
    // handler exists. If `parsed` becomes non-null the user has loaded a
    // real resume and the faded preview is no longer needed.
    if (parsed !== null || !onLoadSample) return;
    if (sampleText !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
        const url = `${base}sample-resume.md`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        if (cancelled) return;
        setSampleText(text);
        setSampleParsed(parseResume(text));
      } catch {
        /* swallow — the static empty state is the graceful fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [parsed, onLoadSample, sampleText]);

  if (!parsed) {
    // Faded-sample variant (#96): only when the fetch succeeded AND a CTA
    // is wired up. Otherwise fall through to the legacy static empty state
    // so a network failure (or a host without onLoadSample) still renders
    // a friendly message.
    if (onLoadSample && sampleParsed && sampleText !== null) {
      return (
        <FadedSamplePreview
          sampleText={sampleText}
          sampleParsed={sampleParsed}
          template={template}
          mode={mode}
          onLoadSample={onLoadSample}
        />
      );
    }
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

  /** Build the metadata items for the contact line, joined by separators.
      Each item carries a stable `key` derived from its own identity (the
      field name, or the link URL) — never an array index, so React can
      reconcile correctly if the frontmatter changes. */
  const metaItems: React.ReactElement[] = [];
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
    <div className="preview-frame" data-mode={mode === 'ats' ? 'ats' : undefined}>
      {mode === 'ats' && (
        // A genuine, non-color-coded affordance: the user has chosen a viewing
        // mode that ignores the theme, so we say so in plain text and announce
        // the change via a live region. `data-print-hide` keeps the badge out
        // of printed / exported output.
        <div className="preview-mode-badge" role="status" data-print-hide>
          <strong>ATS preview</strong>
          <span>
            Showing a plain, single-column rendering — the active theme is muted in this view.
          </span>
        </div>
      )}
      <article
        className="resume-preview"
        aria-label="Rendered resume"
        data-template={template}
        data-mode={mode === 'ats' ? 'ats' : undefined}
      >
        {warnings.length > 0 && (
          <div className="preview-warnings" role="status" data-print-hide>
            <strong>Heads up — the parser noted:</strong>
            <ul>
              {warnings.map((warning, index) => (
                // Warning strings are the natural stable key. They are
                // usually unique; a `#index` suffix disambiguates the rare
                // case of two identical warnings without falling back to a
                // bare index key.
                <li key={`${warning}#${index}`}>{warning}</li>
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
                  // Key the wrapper by the item's OWN stable key ("loc",
                  // "email", "link-…") rather than the array index, so an
                  // index-keyed wrapper never shadows the item's identity.
                  // The wrapper uses `display: contents` via a CSS class so it
                  // doesn't impose its own box on the flex/inline layout — see
                  // `.resume-preview__contact-meta-item` in global.css. Done as
                  // a class rather than inline `style=` so the CSP can drop
                  // `'unsafe-inline'` from `style-src` (#38).
                  <span key={String(item.key)} className="resume-preview__contact-meta-item">
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

/* ----------------------------------------------------------------------- *
 * FadedSamplePreview (#96)                                                 *
 *                                                                          *
 * A miniature standalone preview of the bundled sample resume, rendered     *
 * at ~0.55 opacity behind an overlay that carries the call-to-action. The   *
 * overlay layer is `pointer-events: none` so it never blocks the click on   *
 * the inner "Try the sample" button — exactly what the spec asks for.       *
 *                                                                           *
 * It deliberately uses a SEPARATE class root (`faded-sample-*`) rather than *
 * reusing `.resume-preview` directly, so the faded styling can never bleed  *
 * into the real preview when a real resume is loaded.                       *
 * ----------------------------------------------------------------------- */

interface FadedSamplePreviewProps {
  sampleText: string;
  sampleParsed: ParsedResume;
  template: ResumeTemplate;
  mode: PreviewMode;
  onLoadSample: (text: string, sourceName: string) => void;
}

function FadedSamplePreview({
  sampleText,
  sampleParsed,
  template,
  mode,
  onLoadSample,
}: FadedSamplePreviewProps) {
  const { name, role, location, email, phone, links } = sampleParsed.frontmatter;
  const hasContact = Boolean(
    name || role || location || email || phone || (links && links.length > 0),
  );

  const bodyHtml = useMemo(
    () => (hasContact ? dedupeIdentity(sampleParsed.html) : sampleParsed.html),
    [sampleParsed, hasContact],
  );

  /* Mirror the real preview's contact-meta construction so the faded
     sample is visually identical to a real load — just dialed down. The
     keys are stable, derived from the item's own identity, the same way
     the live preview does it. */
  const metaItems: React.ReactElement[] = [];
  if (location) metaItems.push(<span key="loc">{location}</span>);
  if (email) metaItems.push(<span key="email">{email}</span>);
  if (phone) metaItems.push(<span key="phone">{phone}</span>);
  if (links) {
    for (const link of links) {
      metaItems.push(<span key={`link-${link.url}`}>{link.label}</span>);
    }
  }

  return (
    <div className="preview-frame">
      <div className="faded-sample" data-print-hide>
        {/* The faded layer — a real preview at low opacity, inert to clicks
            and to assistive tech (it is purely decorative; the overlay
            carries the meaningful affordance). `inert` (React 19) also
            removes the layer's anchors from the tab order, satisfying
            axe's `aria-hidden-focus` rule (#111). */}
        <div className="faded-sample__layer" aria-hidden="true" inert>
          <article
            className="resume-preview faded-sample__article"
            data-template={template}
            data-mode={mode === 'ats' ? 'ats' : undefined}
          >
            {hasContact && (
              <header className="resume-preview__contact">
                {name && <p className="resume-preview__contact-name">{name}</p>}
                {role && <p className="resume-preview__contact-role">{role}</p>}
                {metaItems.length > 0 && (
                  <p className="resume-preview__contact-meta">
                    {metaItems.map((item, index) => (
                      <span key={String(item.key)} className="resume-preview__contact-meta-item">
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
            {/* Same `dangerouslySetInnerHTML` contract as the real preview:
                the html came out of parseResume(), already sanitized by
                DOMPurify. */}
            <div className="resume-preview__body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
          </article>
        </div>

        {/* The CTA overlay. The wrapper carries pointer-events: none (set
            in global.css) so it never intercepts clicks; the button inside
            re-enables pointer events on itself so it remains clickable. */}
        <div className="faded-sample__overlay">
          <div className="faded-sample__cta">
            <span className="faded-sample__icon" aria-hidden="true">
              <Icon name="file" size={36} />
            </span>
            <p className="faded-sample__title">Live preview will appear here</p>
            <p className="faded-sample__desc">
              This is the bundled sample, dimmed. Load it or upload your own to start editing.
            </p>
            <button
              type="button"
              className="btn btn--primary faded-sample__action"
              onClick={() => onLoadSample(sampleText, 'sample-resume.md')}
            >
              Try the sample
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * MarkdownUploader — gets resume Markdown into the app.
 *
 * Five input paths, four fully local + one explicit network call:
 *   1. A native file <input> (.md / .markdown / .txt).
 *   2. A drag-and-drop zone over that input.
 *   3. A "Load sample" button that fetches the bundled sample resume — a
 *      same-origin static asset.
 *   4. "Import JSON Resume" — picks a local `.json` file and converts it
 *      via `fromJsonResume`. Fully local; no network.
 *   5. "Import from Gist" — the one deliberate network call in the whole
 *      app. ONLY triggered when the user pastes a gist URL and clicks
 *      Import. Clearly disclosed at the input.
 *
 * Two-phase affordance (#51): with no resume loaded the dropzone is the hero
 * — a large drop target with the secondary import affordances tucked below.
 * Once a resume IS loaded it collapses to a compact one-line bar with
 * Replace-file and Clear actions, so the chrome no longer dominates.
 *
 * Validation is forgiving: an unknown file type or read failure produces a
 * clear error; an oversized file produces a non-blocking warning but still
 * loads. Browsers without the File API degrade to a plain message.
 */
import { useCallback, useId, useRef, useState } from 'react';
import Icon from './Icon';
import { fromJsonResume } from '../utils/jsonresume';
import { fetchGistMarkdown, isGistUrl } from '../utils/gist';

/** Files larger than this trigger a soft warning (not a hard failure). */
const SOFT_SIZE_LIMIT = 1024 * 1024; // 1 MB
const ACCEPT = '.md,.markdown,.txt';
const ACCEPTED_EXTENSIONS = ['.md', '.markdown', '.txt'];
const JSON_ACCEPT = '.json,application/json';

interface MarkdownUploaderProps {
  /** Called with the resume text once it has been read locally. */
  onLoad: (text: string, sourceName: string) => void;
  /** Whether a resume is currently loaded — drives the collapsed affordance. */
  hasResume: boolean;
  /** Line count of the current resume, shown in the collapsed bar. */
  lineCount: number;
  /** Name of the current source file (e.g. "resume.md"). */
  sourceName: string;
  /** Clear the current resume and return to the empty state. */
  onClear: () => void;
}

/** True when the browser exposes the File / FileReader APIs we rely on. */
function hasFileApi(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.File !== 'undefined' &&
    typeof window.FileReader !== 'undefined'
  );
}

function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export default function MarkdownUploader({
  onLoad,
  hasResume,
  lineCount,
  sourceName,
  onClear,
}: MarkdownUploaderProps) {
  const inputId = useId();
  const jsonInputId = useId();
  const gistInputId = useId();
  const gistDisclosureId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const [gistUrl, setGistUrl] = useState('');
  const [isFetchingGist, setIsFetchingGist] = useState(false);

  const fileApiAvailable = hasFileApi();

  /** Read one dropped/picked file as text and hand it upstream. */
  const readFile = useCallback(
    (file: File) => {
      setError(null);
      setNotice(null);

      if (!hasAcceptedExtension(file.name)) {
        setError(`"${file.name}" is not a supported file. Use a .md, .markdown, or .txt file.`);
        return;
      }

      if (file.size > SOFT_SIZE_LIMIT) {
        setNotice(
          `That file is larger than 1 MB — it should still work, but resumes are usually much smaller.`,
        );
      }

      const reader = new FileReader();
      reader.onerror = () => {
        setError(`Could not read "${file.name}". Please try again.`);
      };
      reader.onload = () => {
        const text = reader.result;
        if (typeof text !== 'string') {
          setError(`Could not read "${file.name}" as text.`);
          return;
        }
        onLoad(text, file.name);
      };
      reader.readAsText(file);
    },
    [onLoad],
  );

  /**
   * Read a JSON Resume file: parse, convert via `fromJsonResume`, surface
   * any warnings (non-blocking) and load the synthesized Markdown.
   */
  const readJsonResume = useCallback(
    (file: File) => {
      setError(null);
      setNotice(null);

      if (!/\.json$/i.test(file.name) && file.type && !file.type.includes('json')) {
        setError(`"${file.name}" does not look like a JSON Resume (.json) file.`);
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => setError(`Could not read "${file.name}". Please try again.`);
      reader.onload = () => {
        const text = reader.result;
        if (typeof text !== 'string') {
          setError(`Could not read "${file.name}" as text.`);
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          setError(`"${file.name}" is not valid JSON.`);
          return;
        }
        const { markdown, warnings } = fromJsonResume(parsed);
        if (markdown.length === 0) {
          setError(warnings[0] ?? 'That JSON file did not look like a JSON Resume document.');
          return;
        }
        if (warnings.length > 0) {
          // Surface up to two warnings inline; the rest are unlikely to matter.
          const head = warnings.slice(0, 2).join(' ');
          const more = warnings.length > 2 ? ` (+${warnings.length - 2} more)` : '';
          setNotice(`Imported with warnings — ${head}${more}`);
        }
        // Replace the .json with .md so the filename chip stays sensible.
        const baseName = file.name.replace(/\.json$/i, '.md');
        onLoad(markdown, baseName);
      };
      reader.readAsText(file);
    },
    [onLoad],
  );

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) readFile(file);
      // Reset so picking the same file again still fires `change`.
      event.target.value = '';
    },
    [readFile],
  );

  const handleJsonInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) readJsonResume(file);
      event.target.value = '';
    },
    [readJsonResume],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (!file) return;
      // Allow dropping a JSON Resume too — convenient and unsurprising.
      if (/\.json$/i.test(file.name)) {
        readJsonResume(file);
      } else {
        readFile(file);
      }
    },
    [readFile, readJsonResume],
  );

  /** Load the bundled sample resume — a same-origin static asset. */
  const loadSample = useCallback(async () => {
    setError(null);
    setNotice(null);
    setIsLoadingSample(true);
    try {
      // BASE_URL may or may not carry a trailing slash depending on the
      // Astro `base` config; normalize to exactly one before joining.
      const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
      const url = `${base}sample-resume.md`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const text = await response.text();
      onLoad(text, 'sample-resume.md');
    } catch {
      setError('Could not load the sample resume. Please try again.');
    } finally {
      setIsLoadingSample(false);
    }
  }, [onLoad]);

  /**
   * Fetch the gist the user just pasted. This is the SINGLE deliberate
   * network call this app makes; it sends no resume content outbound and
   * requires no auth. The CSP in BaseLayout.astro grants `api.github.com`
   * exactly for this path.
   */
  const importFromGist = useCallback(async () => {
    setError(null);
    setNotice(null);
    const url = gistUrl.trim();
    if (url.length === 0) {
      setError('Paste a Gist URL first — for example https://gist.github.com/you/abcdef…');
      return;
    }
    if (!isGistUrl(url)) {
      setError("That doesn't look like a Gist URL. Expected https://gist.github.com/…");
      return;
    }
    setIsFetchingGist(true);
    try {
      const { markdown, filename } = await fetchGistMarkdown(url);
      onLoad(markdown, filename || 'gist.md');
      setGistUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import the Gist.');
    } finally {
      setIsFetchingGist(false);
    }
  }, [gistUrl, onLoad]);

  const handleGistSubmit = useCallback(
    (event: React.SyntheticEvent<HTMLFormElement>) => {
      event.preventDefault();
      void importFromGist();
    },
    [importFromGist],
  );

  const handleClear = useCallback(() => {
    setError(null);
    setNotice(null);
    onClear();
  }, [onClear]);

  /* The shared, visually-hidden file inputs — referenced from both phases. */
  const fileInput = (
    <input
      ref={fileInputRef}
      id={inputId}
      className="visually-hidden"
      type="file"
      accept={ACCEPT}
      onChange={handleInputChange}
    />
  );

  const jsonFileInput = (
    <input
      ref={jsonInputRef}
      id={jsonInputId}
      className="visually-hidden"
      type="file"
      accept={JSON_ACCEPT}
      onChange={handleJsonInputChange}
    />
  );

  /* Errors / notices, shared by both phases. */
  const messages = (
    <>
      {error && (
        <p className="uploader__error" role="alert">
          <Icon name="alert" size={15} />
          <span>{error}</span>
        </p>
      )}
      {notice && (
        <p className="uploader__notice" role="status">
          <Icon name="info" size={15} />
          <span>{notice}</span>
        </p>
      )}
    </>
  );

  /* ----- Phase 2: a resume is loaded — collapsed one-line affordance. ----- */
  if (hasResume) {
    return (
      <div className="uploader">
        <div className="uploader__loaded">
          <span className="uploader__loaded-icon" aria-hidden="true">
            <Icon name="file" size={15} />
          </span>
          <span className="uploader__loaded-name">{sourceName}</span>
          <span className="uploader__loaded-sep" aria-hidden="true">
            ·
          </span>
          <span className="uploader__loaded-lines">
            {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          </span>
          <span className="uploader__loaded-spacer" />
          {fileApiAvailable && (
            <label className="btn btn--ghost uploader__loaded-action" htmlFor={inputId}>
              <Icon name="replace" size={14} />
              Replace file
            </label>
          )}
          <button
            type="button"
            className="btn btn--ghost uploader__loaded-action"
            onClick={handleClear}
          >
            <Icon name="trash" size={14} />
            Clear
          </button>
        </div>
        {fileInput}
        {messages}
      </div>
    );
  }

  /* ----- Phase 1: nothing loaded — the dropzone is the hero. ----- */
  return (
    <div className="uploader">
      {fileApiAvailable ? (
        <div
          className={
            isDragging ? 'uploader__dropzone uploader__dropzone--active' : 'uploader__dropzone'
          }
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <span className="uploader__dropzone-glyph" aria-hidden="true">
            <Icon name="file" size={28} />
          </span>
          <span className="uploader__dropzone-title">Drop a Markdown file here</span>
          <span>or pick one — nothing leaves your browser.</span>
          <div className="uploader__actions">
            <label className="btn btn--primary" htmlFor={inputId}>
              Choose file
            </label>
            {fileInput}
            <button type="button" className="btn" onClick={loadSample} disabled={isLoadingSample}>
              {isLoadingSample ? 'Loading sample…' : 'Load sample'}
            </button>
            <label className="btn" htmlFor={jsonInputId}>
              Import JSON Resume
            </label>
            {jsonFileInput}
          </div>
        </div>
      ) : (
        <div className="uploader__notice" role="status">
          <Icon name="info" size={15} />
          <span>
            This browser does not support local file uploads. You can still paste your resume
            Markdown directly into the editor below, or load the sample.
            <span className="uploader__actions">
              <button type="button" className="btn" onClick={loadSample} disabled={isLoadingSample}>
                {isLoadingSample ? 'Loading sample…' : 'Load sample'}
              </button>
            </span>
          </span>
        </div>
      )}

      {/* ----- Optional: import from a public GitHub Gist (#33) ----- */}
      <details className="uploader__gist">
        <summary className="uploader__gist-summary">Import from a public GitHub Gist</summary>
        <form className="uploader__gist-form" onSubmit={handleGistSubmit}>
          <label htmlFor={gistInputId} className="uploader__gist-label">
            Gist URL
          </label>
          <div className="uploader__gist-row">
            <input
              id={gistInputId}
              className="text-input uploader__gist-input"
              type="url"
              inputMode="url"
              placeholder="https://gist.github.com/you/abc123…"
              value={gistUrl}
              onChange={(event) => setGistUrl(event.target.value)}
              aria-describedby={gistDisclosureId}
              disabled={isFetchingGist}
            />
            <button
              type="submit"
              className="btn btn--primary"
              disabled={isFetchingGist || gistUrl.trim().length === 0}
            >
              {isFetchingGist ? 'Importing…' : 'Import'}
            </button>
          </div>
          <p id={gistDisclosureId} className="uploader__gist-disclosure">
            <Icon name="info" size={13} />
            <span>
              Heads up — this is a network request. When you click Import, the app fetches the Gist
              anonymously from <code>api.github.com</code>: no login, no resume content sent
              outbound, only the Gist ID in the URL. The Gist must be public.
            </span>
          </p>
        </form>
      </details>

      {messages}
    </div>
  );
}

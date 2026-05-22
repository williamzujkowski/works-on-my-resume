/**
 * MarkdownUploader — gets resume Markdown into the app.
 *
 * Three input paths, all fully local:
 *   1. A native file <input> (.md / .markdown / .txt).
 *   2. A drag-and-drop zone over that input.
 *   3. A "Load sample" button that fetches the bundled sample resume — a
 *      same-origin static asset, the only fetch this app makes.
 *
 * Two-phase affordance (#51): with no resume loaded the dropzone is the hero
 * — a large drop target. Once a resume IS loaded it collapses to a compact
 * one-line bar (`resume.md · 87 lines`) with Replace-file and Clear actions,
 * so it no longer dominates the editor pane.
 *
 * Validation is forgiving: an unknown file type or read failure produces a
 * clear error; an oversized file produces a non-blocking warning but still
 * loads. Browsers without the File API degrade to a plain message.
 */
import { useCallback, useId, useRef, useState } from 'react';
import Icon from './Icon';

/** Files larger than this trigger a soft warning (not a hard failure). */
const SOFT_SIZE_LIMIT = 1024 * 1024; // 1 MB
const ACCEPT = '.md,.markdown,.txt';
const ACCEPTED_EXTENSIONS = ['.md', '.markdown', '.txt'];

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoadingSample, setIsLoadingSample] = useState(false);

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

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) readFile(file);
      // Reset so picking the same file again still fires `change`.
      event.target.value = '';
    },
    [readFile],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) readFile(file);
    },
    [readFile],
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

  const handleClear = useCallback(() => {
    setError(null);
    setNotice(null);
    onClear();
  }, [onClear]);

  /* The shared, visually-hidden file input — referenced from both phases. */
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
      {messages}
    </div>
  );
}

/**
 * MarkdownEditor — a controlled monospace <textarea> for the resume source.
 *
 * Emits every keystroke up to ResumeStudio, which debounces re-parsing. The
 * editor itself is intentionally dumb: it holds no parsing logic or state.
 */
import { useId, useRef, useState, useEffect } from 'react';

interface MarkdownEditorProps {
  /** Current Markdown source string (controlled). */
  value: string;
  /** Called with the new value on every edit. */
  onChange: (value: string) => void;
}

const SNIPPETS = {
  Experience: '## Experience\n\n### **Role** at **Company**\n*Start Date – End Date*\n\n- Achieved X by doing Y.\n- Improved Z.\n\n',
  Education: '## Education\n\n### **Degree**, Major\n*University Name*\n*Graduation Year*\n\n',
  Skills: '## Skills\n\n- **Languages**: \n- **Frameworks**: \n- **Tools**: \n\n',
};

export default function MarkdownEditor({ value, onChange }: MarkdownEditorProps) {
  const textareaId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [softWrap, setSoftWrap] = useState(false);

  const lineCount = value.length === 0 ? 1 : value.split('\n').length;
  const charCount = value.length;

  const insertSnippet = (snippet: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = value.substring(0, start) + snippet + value.substring(end);
    onChange(next);
    // Restore focus and cursor position after React re-renders
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + snippet.length, start + snippet.length);
    }, 0);
  };

  const syncScroll = () => {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  // Keep gutter scroll in sync when value changes (e.g. typing)
  useEffect(() => {
    syncScroll();
  }, [value]);

  return (
    <div className="editor">
      <div className="editor__toolbar">
        <label className="field-label" htmlFor={textareaId} style={{ marginBottom: 0 }}>
          Markdown source
        </label>
        <div className="editor__toolbar-spacer" />
        <span className="editor__toolbar-label">Insert:</span>
        <div className="editor__snippets">
          {(Object.entries(SNIPPETS) as [keyof typeof SNIPPETS, string][]).map(([name, text]) => (
            <button
              key={name}
              type="button"
              className="btn btn--ghost editor__btn-small"
              onClick={() => insertSnippet(text)}
              title={`Insert ${name} snippet`}
            >
              + {name}
            </button>
          ))}
        </div>
        <div className="editor__toolbar-divider" />
        <label className="editor__checkbox">
          <input
            type="checkbox"
            checked={softWrap}
            onChange={(e) => setSoftWrap(e.target.checked)}
          />
          Soft-wrap
        </label>
      </div>

      <div className="editor__container">
        {!softWrap && (
          <div className="editor__gutter" ref={gutterRef} aria-hidden="true">
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          id={textareaId}
          className={`editor__textarea ${softWrap ? 'editor__textarea--wrap' : ''}`}
          value={value}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={'Paste your resume Markdown here,\nor upload a file / load the sample above.'}
          aria-describedby={`${textareaId}-meta`}
          onChange={(event) => onChange(event.target.value)}
          onScroll={syncScroll}
        />
      </div>
      <div id={`${textareaId}-meta`} className="editor__meta">
        <span>{lineCount} lines</span>
        <span>{charCount.toLocaleString()} chars</span>
      </div>
    </div>
  );
}

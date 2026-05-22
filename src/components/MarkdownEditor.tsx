/**
 * MarkdownEditor — a controlled monospace <textarea> for the resume source.
 *
 * Emits every keystroke up to ResumeStudio, which debounces re-parsing. The
 * editor itself is intentionally dumb: it holds no parsing logic or state.
 */
import { useId } from 'react';

interface MarkdownEditorProps {
  /** Current Markdown source string (controlled). */
  value: string;
  /** Called with the new value on every edit. */
  onChange: (value: string) => void;
}

export default function MarkdownEditor({ value, onChange }: MarkdownEditorProps) {
  const textareaId = useId();

  const lineCount = value.length === 0 ? 0 : value.split('\n').length;
  const charCount = value.length;

  return (
    <div className="editor">
      <label className="field-label" htmlFor={textareaId}>
        Markdown source
      </label>
      <textarea
        id={textareaId}
        className="editor__textarea"
        value={value}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        placeholder={'Paste your resume Markdown here,\nor upload a file / load the sample above.'}
        aria-describedby={`${textareaId}-meta`}
        onChange={(event) => onChange(event.target.value)}
      />
      <div id={`${textareaId}-meta`} className="editor__meta">
        <span>{lineCount} lines</span>
        <span>{charCount.toLocaleString()} chars</span>
      </div>
    </div>
  );
}

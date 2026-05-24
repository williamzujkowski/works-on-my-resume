/**
 * ResumeHealth — the stage-aware Resume Health panel (#85).
 *
 * Reads the current Markdown + its `ParsedResume`, runs `analyzeResume`, and
 * surfaces a single composite score plus a list of findings. The author
 * picks a career stage (junior / mid / senior) and the rubric retunes —
 * stage selection is persisted via `setStoredCareerStage` so it survives a
 * reload.
 *
 * UI contract
 * -----------
 * Class names are stable hooks the integration agent will style in
 * `global.css`. The component itself ships zero inline `style=` attributes
 * (CSP: see CONTRIBUTING.md — `style-src` does not allow `'unsafe-inline'`).
 *
 * Privacy
 * -------
 * No resume content is persisted by this component. The career-stage slug is
 * the only thing written to localStorage, matching the project's posture.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ParsedResume } from '../types';
import { analyzeResume, type CareerStage, type HealthFinding } from '../utils/health';
import { getStoredCareerStage, setStoredCareerStage } from '../utils/storage';

interface Props {
  /** Raw Markdown source (current editor contents). */
  markdown: string;
  /** Parsed view of `markdown`, or `null` when nothing has been loaded. */
  parsed: ParsedResume | null;
  /** Hook for "Jump to line N" links. The integration agent wires the editor. */
  onJumpToLine?: (line: number) => void;
}

/** Ordered stage choices for the segmented control. */
const STAGES: ReadonlyArray<{ value: CareerStage; label: string }> = [
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
];

export default function ResumeHealth({ markdown, parsed, onJumpToLine }: Props) {
  /* ----- Stage state -----
     The initial value is `'mid'` so SSR and the first client paint agree
     (localStorage is client-only). A mount-time effect promotes the stored
     value once the client is alive — same pattern as the shortcuts prefs
     and the ATS mode in ResumeStudio. */
  const [stage, setStage] = useState<CareerStage>('mid');

  useEffect(() => {
    const stored = getStoredCareerStage();
    if (stored) setStage(stored);
  }, []);

  /** Persist on user-initiated change (NOT on the mount-time hydration). */
  function changeStage(next: CareerStage): void {
    setStage(next);
    setStoredCareerStage(next);
  }

  /* ----- Live analysis: pure, cheap, recomputed on input changes.
       The hook MUST run on every render (rules of hooks), so we compute
       a placeholder report when `parsed` is null and short-circuit the
       render below — never inside the hook list. */
  const report = useMemo(() => {
    if (!parsed) return null;
    return analyzeResume(markdown, parsed, stage);
  }, [markdown, parsed, stage]);

  /* ----- Empty state: no resume loaded yet ----- */
  if (!parsed || !report) {
    return (
      <section
        className="health"
        aria-label="Resume Health"
        // The empty state still mounts the panel so layout doesn't shift
        // when a resume is loaded — only the body content changes.
      >
        <header className="health__header">
          <p className="health__score-stage">Resume Health</p>
        </header>
        <p className="health__empty">Load a resume to see Health feedback.</p>
      </section>
    );
  }

  return (
    <section className="health" aria-label="Resume Health">
      <header className="health__header">
        <p className="health__score">
          <span className="health__score-num" aria-label={`Score ${report.score} out of 100`}>
            {report.score}
          </span>
          <span className="health__score-stage">Resume Health · {labelFor(stage)}</span>
        </p>

        <div className="health__stage-picker" role="radiogroup" aria-label="Career stage">
          {STAGES.map((opt) => {
            const active = stage === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                className={
                  active ? 'health__stage-btn health__stage-btn--active' : 'health__stage-btn'
                }
                onClick={() => changeStage(opt.value)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </header>

      {report.findings.length === 0 ? (
        <p className="health__empty">Looking solid for a {labelFor(stage).toLowerCase()} resume.</p>
      ) : (
        <ul className="health__list">
          {report.findings.map((finding, i) => (
            <FindingItem
              // The same rule id can fire multiple times (weak-verb on
              // every offending line); include the index for uniqueness.
              key={`${finding.id}-${finding.line ?? 'doc'}-${i}`}
              finding={finding}
              onJumpToLine={onJumpToLine}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Human label for a stage, used in the header copy. */
function labelFor(stage: CareerStage): string {
  switch (stage) {
    case 'junior':
      return 'Junior';
    case 'mid':
      return 'Mid';
    case 'senior':
      return 'Senior';
  }
}

/** One finding row. Extracted so the jump-button logic doesn't muddy the list. */
function FindingItem({
  finding,
  onJumpToLine,
}: {
  finding: HealthFinding;
  onJumpToLine?: (line: number) => void;
}) {
  const className = `health__item health__item--${finding.severity}`;
  const dotLabel = severityLabel(finding.severity);

  return (
    <li className={className} data-rule={finding.id}>
      <span className="health__item-dot" aria-label={dotLabel} role="img" />
      <span className="health__item-message">{finding.message}</span>
      {finding.line !== undefined && onJumpToLine && (
        <button
          type="button"
          className="health__item-jump"
          onClick={() => onJumpToLine(finding.line as number)}
        >
          Jump to line {finding.line}
        </button>
      )}
    </li>
  );
}

/** Accessible label for the severity glyph. */
function severityLabel(severity: HealthFinding['severity']): string {
  switch (severity) {
    case 'good':
      return 'Good';
    case 'warn':
      return 'Warning';
    case 'bad':
      return 'Needs attention';
  }
}

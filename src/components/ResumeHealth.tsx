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
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ParsedResume } from '../types';
import { analyzeResume, type CareerStage, type HealthFinding } from '../utils/health';
import { getRewriteCandidates, type RewriteCandidate } from '../utils/bulletPatterns';
import { getStoredCareerStage, setStoredCareerStage } from '../utils/storage';

interface Props {
  /** Raw Markdown source (current editor contents). */
  markdown: string;
  /** Parsed view of `markdown`, or `null` when nothing has been loaded. */
  parsed: ParsedResume | null;
  /**
   * Hook for "Jump to line N" buttons. The editor focuses the textarea,
   * selects the entire target line, and scrolls into view.
   */
  onJumpToLine?: (line: number) => void;
  /**
   * Hook for clickable findings (#115). Selects the literal offender
   * substring on the target line rather than the whole line. The editor
   * gracefully falls back to whole-line selection when the offender has
   * been edited away since the finding was computed.
   */
  onJumpToOffender?: (line: number, offender: string) => void;
  /**
   * Hook for "Suggest a fix" (#115). Inserts a candidate rewrite as a new
   * bullet directly above the original line. Routed through the editor's
   * value/onChange path — never into the preview DOM, so DOMPurify still
   * owns the trust boundary on the way to rendered HTML.
   */
  onInsertRewrite?: (targetLine: number, rewrittenLine: string) => void;
  /**
   * Hook for "Open an example" (#115, #120). The parent decides what to do
   * with the section name: when the writer's resume already has it, jump
   * the editor textarea to that H2; otherwise open a dialog showing the
   * bundled sample's section so the writer sees a worked example. The
   * Health panel always shows the button — the parent owns the fallback.
   */
  onJumpToSection?: (sectionTitle: string) => void;
}

/** Ordered stage choices for the segmented control. */
const STAGES: ReadonlyArray<{ value: CareerStage; label: string }> = [
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
];

export default function ResumeHealth({
  markdown,
  parsed,
  onJumpToLine,
  onJumpToOffender,
  onInsertRewrite,
  onJumpToSection,
}: Props) {
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
              onJumpToOffender={onJumpToOffender}
              onInsertRewrite={onInsertRewrite}
              onJumpToSection={onJumpToSection}
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

/**
 * One finding row (#115). Renders the severity dot + message, then up to
 * two affordance buttons:
 *
 *  - "Jump to line N" — present when the finding carries a `line`. Clicking
 *    selects the offender substring on that line (or the whole line, if no
 *    `offender` was supplied) and scrolls the editor textarea to it.
 *  - Either "Suggest a fix" (templated rewrite tray) or "Open an example"
 *    (jump to a sample section), depending on the finding's `suggest`
 *    shape. Buttons are mutually exclusive — a finding is either
 *    actionable via a mechanical rewrite, or it points at an example. We
 *    never offer both for the same finding because the second option is
 *    always a fallback for findings without a clean templated fix.
 *
 * The "Suggest a fix" tray opens beneath the row and lists 2-3 candidate
 * rewrites derived from `getRewriteCandidates` against the offending
 * bullet source line. Picking one inserts it as a sibling bullet above the
 * original through `onInsertRewrite`; the in-editor rewrite-tray (#93) and
 * this tray share the exact same pattern library, so the two affordances
 * cannot disagree on what a rewrite looks like.
 */
function FindingItem({
  finding,
  onJumpToLine,
  onJumpToOffender,
  onInsertRewrite,
  onJumpToSection,
}: {
  finding: HealthFinding;
  onJumpToLine?: (line: number) => void;
  onJumpToOffender?: (line: number, offender: string) => void;
  onInsertRewrite?: (targetLine: number, rewrittenLine: string) => void;
  onJumpToSection?: (sectionTitle: string) => void;
}) {
  const className = `health__item health__item--${finding.severity}`;
  const dotLabel = severityLabel(finding.severity);

  /* Suggest-a-fix tray state. Closed by default; opens only when the user
     clicks the "Suggest a fix" button. Each tray is per-row so the panel
     can show two open trays at once (rare in practice — most findings of
     the same rule are co-located in the bullet list). */
  const [fixOpen, setFixOpen] = useState(false);
  const trayRef = useRef<HTMLDivElement>(null);

  /* Close the tray when a pointer-down lands outside it. Mirrors the
     pattern the in-editor rewrite tray (#93) and snippet popover use. */
  useEffect(() => {
    if (!fixOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!trayRef.current?.contains(event.target as Node)) {
        setFixOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [fixOpen]);

  /* Derive the candidate rewrites when the suggest shape is a 'rewrite'.
     useMemo: the bullet text rarely changes for a given finding (it's the
     source line snapshot), and the rewrite library is pure. */
  const rewriteCandidates: RewriteCandidate[] = useMemo(() => {
    if (finding.suggest?.kind !== 'rewrite') return [];
    return getRewriteCandidates(finding.suggest.bulletText);
  }, [finding.suggest]);

  const canJump = finding.line !== undefined && (onJumpToOffender || onJumpToLine);
  const canSuggestFix =
    finding.suggest?.kind === 'rewrite' &&
    rewriteCandidates.length > 0 &&
    onInsertRewrite !== undefined &&
    finding.line !== undefined;
  /* "Open an example" is offered whenever the finding is shaped as an
     example suggestion. We always show the button — the parent (ResumeStudio)
     routes the click: if the writer's resume already has the section, jump
     there in the editor; otherwise open a dialog showing the bundled
     sample's section (#120). The Health panel intentionally doesn't know
     about the dialog fallback — it just hands the section name up. */
  const canOpenExample =
    finding.suggest?.kind === 'example' && onJumpToSection !== undefined;

  /**
   * Apply a candidate rewrite: insert above the offending line, close the
   * tray, and let the editor re-select the inserted text. The Health panel
   * never mutates the markdown directly; the editor owns that path.
   */
  function applyRewrite(candidate: RewriteCandidate) {
    if (finding.line === undefined || !onInsertRewrite) return;
    onInsertRewrite(finding.line, candidate.rewrittenLine);
    setFixOpen(false);
  }

  /** "Jump to line" click. Prefer the offender-aware jump when available. */
  function handleJump() {
    if (finding.line === undefined) return;
    if (finding.offender && onJumpToOffender) {
      onJumpToOffender(finding.line, finding.offender);
    } else if (onJumpToLine) {
      onJumpToLine(finding.line);
    }
  }

  return (
    <li className={className} data-rule={finding.id}>
      <span className="health__item-dot" aria-label={dotLabel} role="img" />
      <div className="health__item-body">
        <span className="health__item-message">{finding.message}</span>
        {(canJump || canSuggestFix || canOpenExample) && (
          <div className="health__item-actions">
            {canJump && (
              <button type="button" className="health__item-jump" onClick={handleJump}>
                Jump to line {finding.line}
              </button>
            )}
            {canSuggestFix && (
              <button
                type="button"
                className="health__item-fix"
                aria-haspopup="menu"
                aria-expanded={fixOpen}
                onClick={() => setFixOpen((open) => !open)}
              >
                Suggest a fix
              </button>
            )}
            {!canSuggestFix && canOpenExample && finding.suggest?.kind === 'example' && (
              <button
                type="button"
                className="health__item-example"
                onClick={() =>
                  finding.suggest?.kind === 'example' &&
                  onJumpToSection?.(finding.suggest.section)
                }
              >
                Open an example
              </button>
            )}
          </div>
        )}
        {canSuggestFix && fixOpen && (
          <div className="health__item-tray" ref={trayRef}>
            <ul
              className="health__item-tray-list"
              role="menu"
              aria-label="Rewrite suggestions"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setFixOpen(false);
                }
              }}
            >
              {rewriteCandidates.map((candidate) => (
                <li key={candidate.id} role="none" className="health__item-tray-li">
                  <button
                    type="button"
                    role="menuitem"
                    className="health__item-tray-item"
                    onClick={() => applyRewrite(candidate)}
                  >
                    <span className="health__item-tray-label">{candidate.label}</span>
                    <span className="health__item-tray-preview">{candidate.rewrittenLine}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
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

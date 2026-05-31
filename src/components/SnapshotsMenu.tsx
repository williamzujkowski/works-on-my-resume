/**
 * SnapshotsMenu — version snapshots toolbar control (#94).
 *
 * Sits between the Export popover and the help chip on the toolbar. The
 * trigger reads `Snapshots (N)`. When opened, it surfaces:
 *
 *   - A "Save snapshot" affordance with an inline name input the user
 *     can edit before confirming (Enter to confirm).
 *   - A list of saved snapshots, newest first, each with Load + Delete.
 *
 * Privacy gate: snapshots are LOCAL ONLY and gated on the existing draft
 * autosave opt-in (#32). When the user has NOT enabled "Remember this
 * resume on this device", the trigger is rendered disabled with an
 * explanatory tooltip — opening the popover would be pointless because
 * every helper in storage.ts no-ops in that state. This keeps the privacy
 * invariant from #32 intact without scattering the gate across helpers.
 *
 * No new dependencies, no inline `style={...}` — see AGENTS.md.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ResumeSnapshot } from '../utils/storage';
import { usePopover } from '../utils/usePopover';
import Icon from './Icon';

interface SnapshotsMenuProps {
  /** Snapshots, newest first. The parent owns the canonical list. */
  snapshots: ResumeSnapshot[];
  /** True when draft persistence is enabled (the gate from #32). */
  enabled: boolean;
  /** A name suggestion seeded into the inline input on Save. */
  suggestedName: string;
  /** Persist a new snapshot. The parent does the storage write. */
  onSave: (input: { name: string }) => void;
  /** Load a snapshot back into the editor. */
  onLoad: (snapshot: ResumeSnapshot) => void;
  /** Delete a snapshot by id. */
  onDelete: (id: string) => void;
}

/**
 * Render a snapshot's `savedAt` as a short relative string.
 *
 * Kept inline so we don't take on a date library: the resolution we need
 * is "just now / a few minutes ago / a date" — anything finer would be
 * gold-plating. Falls back to a locale date for anything older than a day.
 */
function relativeTime(savedAt: number): string {
  const now = Date.now();
  const delta = Math.max(0, now - savedAt);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  // Older than a day → a stable date label. Localized; tests run with
  // en-US, where this reads as "May 22, 2026".
  try {
    return new Date(savedAt).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return new Date(savedAt).toISOString().slice(0, 10);
  }
}

export default function SnapshotsMenu({
  snapshots,
  enabled,
  suggestedName,
  onSave,
  onLoad,
  onDelete,
}: SnapshotsMenuProps) {
  const [open, setOpen] = useState(false);
  /* The inline name input. We seed it from `suggestedName` every time the
     popover opens, so a stale value from a previous save can't reappear. */
  const [pendingName, setPendingName] = useState(suggestedName);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const nameInputId = useId();

  /* Reset the seeded name on every open. The parent's `suggestedName` is
     recomputed on each render from current frontmatter + theme + template,
     so the input always reflects the resume the user is looking at. */
  useEffect(() => {
    if (open) setPendingName(suggestedName);
  }, [open, suggestedName]);

  /* Focus the name input on open so Enter-to-save is a single keypress. */
  useEffect(() => {
    if (open) {
      // Defer so the input has mounted.
      const t = window.setTimeout(() => nameInputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  /* Non-modal dismiss/focus plumbing (#202, formerly the #207 reference
     pattern): outside-click closes on a document pointerdown; Escape is
     scoped to the popover ELEMENT via `popoverProps.onKeyDown` so its
     `stopPropagation` halts a host drawer/sheet's own Escape — the inner
     popover closes first, the drawer stays open until a second Escape (#207).
     Focus restores to the trigger on Escape; an outside-click leaves focus
     where the pointer landed, as before. */
  const onClose = useCallback(() => setOpen(false), []);
  const { popoverProps } = usePopover({
    open,
    onClose,
    containerRef: popoverRef,
    triggerRef,
  });

  const handleSave = useCallback(() => {
    const trimmed = pendingName.trim();
    onSave({ name: trimmed.length > 0 ? trimmed : suggestedName });
    // Re-seed for the next save and keep the popover open so the user can
    // see the new entry appear at the top of the list.
    setPendingName(suggestedName);
  }, [pendingName, suggestedName, onSave]);

  const handleNameKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleSave();
      }
    },
    [handleSave],
  );

  const count = snapshots.length;
  /* Zero-state collapse (#112): until at least one snapshot exists, the
     trigger renders as a quiet icon-only button rather than the full
     `Snapshots (N)` pill. The Snapshots count was eating toolbar real
     estate while displaying "0", which carried no information for users
     who hadn't engaged with snapshots yet. Once the user saves their
     first snapshot, the full labeled dropdown returns for the lifetime
     of the session.

     The button's accessible name still says "Save snapshot" / "Snapshots"
     so AT users (and the e2e suite) have a stable hook. */
  const hasSnapshots = count >= 1;
  /* "Save snapshot" reads as both an icon-only button and the popover's
     dialog title — both are correct (the affordance saves a snapshot, and
     the dialog it opens contains a "Save snapshot" section). Tests target
     the button via role='button', so the dialog's own labelledby never
     collides with this. */
  const triggerLabel = hasSnapshots ? `Snapshots (${count})` : 'Save snapshot';
  /* Class modifier signals to CSS that the trigger should render as a
     compact icon-only button. The label sits in aria-label only. */
  const triggerClass = hasSnapshots
    ? 'btn snapshots-menu__trigger'
    : 'btn btn--icon snapshots-menu__trigger snapshots-menu__trigger--icon-only';

  /* Off-gate path: render a DISABLED trigger so the affordance is
     discoverable but inert. The native `title` attribute provides the
     "enable Remember this resume…" hint on hover/long-press; we also wire
     it into aria-describedby so AT users get the same message. The
     zero-state collapse from #112 applies here too — a disabled,
     never-saved trigger reads as an icon button rather than `Snapshots (0)`. */
  if (!enabled) {
    const hint = 'Enable Remember this resume on this device to use snapshots.';
    return (
      <div className="snapshots-menu">
        <button
          type="button"
          className={`${triggerClass} snapshots-menu__trigger--disabled`}
          disabled
          aria-disabled="true"
          title={hint}
          aria-label={`${triggerLabel}. ${hint}`}
        >
          <Icon name="layers" size={14} />
          {hasSnapshots && <>{triggerLabel}</>}
          {hasSnapshots && <Icon name="chevron-down" size={14} />}
        </button>
      </div>
    );
  }

  return (
    <div className="snapshots-menu">
      <button
        type="button"
        ref={triggerRef}
        className={triggerClass}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={hasSnapshots ? undefined : triggerLabel}
        title={hasSnapshots ? undefined : triggerLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="layers" size={14} />
        {hasSnapshots && <>{triggerLabel}</>}
        {hasSnapshots && <Icon name="chevron-down" size={14} />}
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="snapshots-menu__popover"
          role="dialog"
          aria-modal="false"
          aria-labelledby={headingId}
          onKeyDown={popoverProps.onKeyDown}
        >
          <div className="snapshots-menu__save">
            <label id={headingId} className="snapshots-menu__save-label" htmlFor={nameInputId}>
              Save snapshot
            </label>
            <div className="snapshots-menu__save-row">
              <input
                id={nameInputId}
                ref={nameInputRef}
                type="text"
                className="text-input snapshots-menu__name-input"
                value={pendingName}
                onChange={(event) => setPendingName(event.target.value)}
                onKeyDown={handleNameKeyDown}
                placeholder="Name this snapshot"
                aria-label="Snapshot name"
              />
              <button
                type="button"
                className="btn btn--primary snapshots-menu__save-btn"
                onClick={handleSave}
              >
                Save
              </button>
            </div>
            <p className="snapshots-menu__hint">
              Up to 10 snapshots are kept on this device. The oldest is removed when you save an
              11th.
            </p>
          </div>

          {count === 0 ? (
            <p className="snapshots-menu__empty">No snapshots saved yet.</p>
          ) : (
            <ul className="snapshots-menu__list" aria-label="Saved snapshots">
              {snapshots.map((snap) => (
                <li key={snap.id} className="snapshots-menu__item">
                  <div className="snapshots-menu__item-meta">
                    <span className="snapshots-menu__item-name">{snap.name}</span>
                    <span className="snapshots-menu__item-sep" aria-hidden="true">
                      ·
                    </span>
                    <span
                      className="snapshots-menu__item-time"
                      title={new Date(snap.savedAt).toLocaleString()}
                    >
                      {relativeTime(snap.savedAt)}
                    </span>
                  </div>
                  <div className="snapshots-menu__item-actions">
                    <button
                      type="button"
                      className="btn snapshots-menu__item-load"
                      onClick={() => onLoad(snap)}
                      aria-label={`Load snapshot ${snap.name}`}
                    >
                      Load
                    </button>
                    <button
                      type="button"
                      className="btn snapshots-menu__item-delete"
                      onClick={() => onDelete(snap.id)}
                      aria-label={`Delete snapshot ${snap.name}`}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

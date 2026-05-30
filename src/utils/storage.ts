/**
 * localStorage helpers for Works on My Resume.
 *
 * PRIVACY DEFAULT — IMPORTANT:
 * Resume CONTENT is intentionally NOT persisted by default. The Markdown a
 * user pastes or loads never touches localStorage; it lives only in memory
 * for the lifetime of the page. This is the deliberate privacy posture of a
 * local-first tool: nothing about the user's resume is written to disk by
 * the app. The ONLY thing we persist is the chosen theme preference, which
 * carries no personal data.
 *
 * Every access below is wrapped in try/catch and guarded for SSR / disabled
 * storage (private-browsing quota errors, blocked cookies, no `window`).
 * On any failure we degrade silently: reads return `null`, writes no-op.
 */

/** Namespaced key so we never collide with other apps on the same origin. */
const THEME_KEY = 'womr:theme';

/**
 * Namespaced key for the layout-template preference (#30). Templates are
 * purely presentation-layer (no resume content), so persisting the choice
 * carries no personal data, the same trade-off as the theme slug.
 */
const TEMPLATE_KEY = 'womr:template';

/**
 * Namespaced key for the career-stage preference (#85). The career stage
 * tunes the Resume Health rubric (junior / mid / senior); like the theme
 * slug and the template slug, it's a UI preference with no personal data.
 */
const CAREER_STAGE_KEY = 'womr:career-stage';

/**
 * Opt-in draft persistence (#32).
 *
 * Two keys, deliberately separate:
 *  - `DRAFT_ENABLED_KEY` ("1"/"0") — the user's explicit consent that their
 *    resume Markdown may be stored on this device. Default is OFF; the
 *    privacy banner promises nothing is persisted by default and that
 *    promise survives ONLY because we never write `DRAFT_KEY` unless this
 *    flag is "1".
 *  - `DRAFT_KEY` — the actual Markdown body. Only ever written when the
 *    enabled flag is on; purged immediately when the user opts out or
 *    clears the resume.
 */
const DRAFT_KEY = 'womr:draft';
const DRAFT_ENABLED_KEY = 'womr:draft-enabled';

/**
 * Namespaced key for the resume snapshots collection (#94). Gated on the
 * same opt-in (`DRAFT_ENABLED_KEY`) as draft autosave — snapshots are
 * resume content, so the privacy invariant from #32 applies to them too.
 * Declared up here so `setDraftPersistenceEnabled` can clear it on opt-out
 * without forward-referencing the snapshots section below.
 */
const SNAPSHOTS_KEY = 'womr:snapshots';

/**
 * Safely obtain `localStorage`, or `null` when it is unavailable.
 *
 * Returns `null` during SSR (no `window`), and also when the browser throws
 * on property access — some privacy modes make even *reading*
 * `window.localStorage` throw a `SecurityError`.
 */
function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Read the persisted theme slug.
 *
 * @returns The stored slug, or `null` if nothing is stored / storage is
 *          unavailable. The caller is responsible for validating that the
 *          slug still exists in the theme dataset.
 */
export function getStoredThemeSlug(): string | null {
  const store = safeLocalStorage();
  if (!store) return null;
  try {
    const value = store.getItem(THEME_KEY);
    // Treat empty strings as "nothing stored".
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Persist the chosen theme slug.
 *
 * Silently no-ops when storage is unavailable or the write fails (e.g. the
 * quota is exceeded, or storage is disabled). Theme preference is a
 * convenience, never a correctness requirement.
 */
export function setStoredThemeSlug(slug: string): void {
  const store = safeLocalStorage();
  if (!store) return;
  try {
    store.setItem(THEME_KEY, slug);
  } catch {
    /* no-op: persistence is best-effort only */
  }
}

/* ------------------------------------------------------------------ */
/* Opt-in draft persistence (#32)                                      */
/* ------------------------------------------------------------------ */

/**
 * Read whether the user has opted into draft persistence on this device.
 *
 * Defaults to `false` so the privacy promise ("nothing is persisted by
 * default") holds for first-time visitors and for anyone using private
 * browsing — the absence of the key is treated as explicit opt-out.
 */
export function isDraftPersistenceEnabled(): boolean {
  const store = safeLocalStorage();
  if (!store) return false;
  try {
    return store.getItem(DRAFT_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Set whether draft persistence is enabled. When disabled, the stored
 * draft (if any) is purged synchronously — never leave content behind
 * after a user opts out.
 */
export function setDraftPersistenceEnabled(enabled: boolean): void {
  const store = safeLocalStorage();
  if (!store) return;
  try {
    if (enabled) {
      store.setItem(DRAFT_ENABLED_KEY, '1');
    } else {
      // Opt-out: clear the flag, the body, AND any snapshots (#94). Anything
      // else would be a surprise — the user's mental model is "I turned it
      // off → it's gone". Snapshots are also resume content gated on this
      // same flag, so they must go when the gate closes.
      store.removeItem(DRAFT_ENABLED_KEY);
      store.removeItem(DRAFT_KEY);
      store.removeItem(SNAPSHOTS_KEY);
    }
  } catch {
    /* no-op: persistence is best-effort only */
  }
}

/**
 * Read the persisted resume draft, or `null` if none / opted out.
 *
 * Returns `null` when the user has not opted in, even if a stale body
 * somehow exists — the enabled flag is the source of truth.
 */
export function getDraft(): string | null {
  const store = safeLocalStorage();
  if (!store) return null;
  try {
    if (store.getItem(DRAFT_ENABLED_KEY) !== '1') return null;
    const value = store.getItem(DRAFT_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Persist the resume Markdown as a draft. No-op when the user has NOT
 * opted in — the enabled flag is checked here as a safety belt so a
 * mis-wired caller can never accidentally write resume content.
 */
export function setDraft(markdown: string): void {
  const store = safeLocalStorage();
  if (!store) return;
  try {
    if (store.getItem(DRAFT_ENABLED_KEY) !== '1') return;
    store.setItem(DRAFT_KEY, markdown);
  } catch {
    /* no-op: persistence is best-effort only (quota, etc.) */
  }
}

/** Remove the persisted draft. Leaves the enabled flag alone. */
export function clearDraft(): void {
  const store = safeLocalStorage();
  if (!store) return;
  try {
    store.removeItem(DRAFT_KEY);
  } catch {
    /* no-op */
  }
}

/* ------------------------------------------------------------------ */
/* Layout-template preference (#30)                                    */
/* ------------------------------------------------------------------ */

/**
 * Read the persisted layout-template slug.
 *
 * Returns the raw string; callers narrow with `isResumeTemplate` so an
 * unknown legacy value degrades to the default rather than producing a
 * broken layout. Returns `null` when nothing is stored / storage is
 * unavailable.
 */
export function getStoredTemplate(): string | null {
  const store = safeLocalStorage();
  if (!store) return null;
  try {
    const value = store.getItem(TEMPLATE_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Persist the chosen layout-template slug. No-ops silently when storage
 * is unavailable — template preference is a convenience, not correctness.
 */
export function setStoredTemplate(slug: string): void {
  const store = safeLocalStorage();
  if (!store) return;
  try {
    store.setItem(TEMPLATE_KEY, slug);
  } catch {
    /* no-op: persistence is best-effort only */
  }
}

/* ------------------------------------------------------------------ */
/* Career-stage preference (#85)                                       */
/* ------------------------------------------------------------------ */

/** The career-stage rubric the Resume Health panel scores against. */
export type CareerStage = 'junior' | 'mid' | 'senior';

/** True when `value` is a known career stage. */
function isCareerStage(value: unknown): value is CareerStage {
  return value === 'junior' || value === 'mid' || value === 'senior';
}

/**
 * Read the persisted career-stage preference for the Resume Health panel.
 *
 * Returns `null` when nothing is stored, storage is unavailable, or the
 * stored value isn't one of the known stages — the caller substitutes its
 * own default (`'mid'`) so a legacy / corrupted value can't produce an
 * unknown stage.
 */
export function getStoredCareerStage(): CareerStage | null {
  const store = safeLocalStorage();
  if (!store) return null;
  try {
    const value = store.getItem(CAREER_STAGE_KEY);
    return isCareerStage(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Persist the chosen career stage. Silently no-ops when storage is
 * unavailable — the stage preference is a convenience, never correctness.
 */
export function setStoredCareerStage(stage: CareerStage): void {
  const store = safeLocalStorage();
  if (!store) return;
  try {
    store.setItem(CAREER_STAGE_KEY, stage);
  } catch {
    /* no-op: persistence is best-effort only */
  }
}

/**
 * Namespaced key for the app-chrome light/dark preference (#192). Like the
 * theme/template/career-stage slugs this is a UI preference with no personal
 * data. NOTE: the no-flash inline script in `BaseLayout.astro` cannot import
 * this module (it runs in <head> before the bundle), so it hard-codes the
 * same literal `'womr:chrome-mode'` — keep the two in sync.
 */
const CHROME_MODE_KEY = 'womr:chrome-mode';

/**
 * Chrome appearance preference. `'auto'` tracks the OS (the default);
 * `'light'`/`'dark'` force a chrome palette regardless of the OS setting.
 * This governs only the app shell (`--ui-*`), never the resume theme.
 */
export type ChromeMode = 'auto' | 'light' | 'dark';

/** True when `value` is a known chrome mode. */
function isChromeMode(value: unknown): value is ChromeMode {
  return value === 'auto' || value === 'light' || value === 'dark';
}

/**
 * Read the persisted chrome-mode preference, or `null` when nothing is
 * stored / storage is unavailable / the value is unrecognised. Callers
 * substitute `'auto'` as the default so a legacy value can't wedge the UI.
 */
export function getStoredChromeMode(): ChromeMode | null {
  const store = safeLocalStorage();
  if (!store) return null;
  try {
    const value = store.getItem(CHROME_MODE_KEY);
    return isChromeMode(value) ? value : null;
  } catch {
    return null;
  }
}

/** Persist the chosen chrome mode. Best-effort; silently no-ops on failure. */
export function setStoredChromeMode(mode: ChromeMode): void {
  const store = safeLocalStorage();
  if (!store) return;
  try {
    store.setItem(CHROME_MODE_KEY, mode);
  } catch {
    /* no-op: persistence is best-effort only */
  }
}

/* ------------------------------------------------------------------ */
/* Resume version snapshots (#94)                                      */
/* ------------------------------------------------------------------ */

/**
 * The `SNAPSHOTS_KEY` constant lives near the top of this file (alongside
 * the draft keys) so the opt-out path in `setDraftPersistenceEnabled` can
 * reference it. The helpers below operate on the same key.
 *
 * A snapshot is a *local* point-in-time copy of the resume that the user
 * can A/B between — e.g. "applying to Stripe" vs "applying to a startup" —
 * without copy-pasting Markdown around. The privacy invariant from #32 is
 * preserved: snapshots are gated on the same opt-in (`isDraftPersistenceEnabled`)
 * that gates draft autosave. If the user has not consented to persisting
 * resume content on this device, every snapshot helper is a no-op (reads
 * return an empty array, writes silently drop).
 */

/** Hard cap on the number of snapshots retained. Oldest auto-evict on overflow. */
export const MAX_SNAPSHOTS = 10;

/**
 * One persisted resume snapshot.
 *
 * Shape kept narrow on purpose — the snapshot is a frozen view of the few
 * things that make a resume render look the way the user wants it to:
 * the Markdown body, the chosen theme, and the chosen layout template.
 * `name` and `savedAt` are surfaced in the UI.
 */
export interface ResumeSnapshot {
  /** Unique id (timestamp-derived; the row's React key + the delete target). */
  id: string;
  /** Human-readable label, defaulted from frontmatter.name + theme/template. */
  name: string;
  /** The resume Markdown at capture time. */
  markdown: string;
  /** Theme slug that was active at capture time. */
  themeSlug: string;
  /** Layout template slug that was active at capture time. */
  template: string;
  /** Capture timestamp (epoch ms). */
  savedAt: number;
}

/** Input shape for `saveSnapshot` — everything but the auto-generated id. */
export interface ResumeSnapshotInput {
  name: string;
  markdown: string;
  themeSlug: string;
  template: string;
}

/** True when `value` looks like a `ResumeSnapshot` row from storage. */
function isResumeSnapshot(value: unknown): value is ResumeSnapshot {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.markdown === 'string' &&
    typeof v.themeSlug === 'string' &&
    typeof v.template === 'string' &&
    typeof v.savedAt === 'number'
  );
}

/**
 * Read all stored snapshots, newest first.
 *
 * Returns `[]` whenever draft persistence is OFF — the snapshots feature
 * is gated on the same opt-in (#32) as the draft autosave, so a user who
 * has not consented to local persistence sees no snapshots even if a stale
 * entry exists in storage.
 *
 * Malformed entries (legacy / corrupted) are silently filtered out rather
 * than thrown — the caller never has to defend against a broken row.
 */
export function getSnapshots(): ResumeSnapshot[] {
  if (!isDraftPersistenceEnabled()) return [];
  const store = safeLocalStorage();
  if (!store) return [];
  try {
    const raw = store.getItem(SNAPSHOTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const rows = parsed.filter(isResumeSnapshot);
    // Newest first — the UI shows them in reverse-chronological order.
    return rows.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/**
 * Persist a new snapshot, evicting the oldest entries if the cap is hit.
 *
 * Gate: draft persistence MUST be on. If it isn't, the call is a silent
 * no-op and returns `null` so a caller can decide whether to surface a
 * "please enable Remember this resume" hint.
 *
 * The 10-entry cap is enforced HERE rather than in the UI, so any caller
 * (current or future) that goes through `saveSnapshot` gets the same
 * guarantee. Oldest-by-`savedAt` are dropped first.
 */
export function saveSnapshot(input: ResumeSnapshotInput): ResumeSnapshot | null {
  if (!isDraftPersistenceEnabled()) return null;
  const store = safeLocalStorage();
  if (!store) return null;
  try {
    const existing = getSnapshots();
    const now = Date.now();
    // Make the id deterministic-ish (timestamp + small random suffix) so two
    // very-fast saves in the same ms don't collide.
    const id = `snap-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const snapshot: ResumeSnapshot = {
      id,
      name: input.name.trim().length > 0 ? input.name.trim() : 'Untitled snapshot',
      markdown: input.markdown,
      themeSlug: input.themeSlug,
      template: input.template,
      savedAt: now,
    };
    // Newest first; trim to MAX_SNAPSHOTS by dropping the tail (the oldest).
    const next = [snapshot, ...existing].slice(0, MAX_SNAPSHOTS);
    store.setItem(SNAPSHOTS_KEY, JSON.stringify(next));
    return snapshot;
  } catch {
    return null;
  }
}

/**
 * Remove a snapshot by id. No-op when storage is unavailable, when the
 * gate is off, or when the id does not exist (idempotent — the UI can
 * call this without checking).
 */
export function deleteSnapshot(id: string): void {
  if (!isDraftPersistenceEnabled()) return;
  const store = safeLocalStorage();
  if (!store) return;
  try {
    const existing = getSnapshots();
    const next = existing.filter((s) => s.id !== id);
    if (next.length === existing.length) return;
    store.setItem(SNAPSHOTS_KEY, JSON.stringify(next));
  } catch {
    /* no-op */
  }
}

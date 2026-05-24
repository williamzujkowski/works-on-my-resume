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
      // Opt-out: clear both the flag AND the body. Anything else would be
      // a surprise — the user's mental model is "I turned it off → it's gone".
      store.removeItem(DRAFT_ENABLED_KEY);
      store.removeItem(DRAFT_KEY);
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

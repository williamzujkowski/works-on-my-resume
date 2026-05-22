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

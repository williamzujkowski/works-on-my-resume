/**
 * AppHero — empty-state hero shown above the workbench when no resume is
 * loaded yet (#127).
 *
 * Anatomy
 * -------
 *   - Large brand title (JetBrains Mono, weight 800) — the same wordmark as
 *     the static `AppHeader.astro` chrome but rendered at display size for
 *     the empty hero.
 *   - Tagline with inline keyboard chips so the headline shortcuts are
 *     learnable without opening the help dialog. `<kbd>` chips reuse the
 *     same tone the rest of the app uses (matches `.kbd-help__dialog kbd`).
 *   - Stat counter row: THEMES · LAYOUTS · TEMPLATES · OFFLINE-READY. The
 *     numbers are passed in from the parent so they always reflect the
 *     in-tree values rather than hard-coded literals — the themes count is
 *     the React-state count (which grows from the boot fallback to ~545
 *     after the lazy dataset resolves), layouts comes from RESUME_TEMPLATES,
 *     templates is a static count of `public/templates/*.md`.
 *
 * Two-phase journey (#51, #127): this component is rendered only when
 * `!hasResume`. Once a resume loads, the parent collapses to the existing
 * compact AppHeader astro chrome (already in the page) and the hero is no
 * longer rendered — no double-render.
 *
 * CSP
 * ---
 * No inline `style={...}` attributes — all visual rules live in global.css
 * under `.app-hero__*` (CSP: `style-src` does not allow `'unsafe-inline'`).
 *
 * Trust
 * -----
 * Every value rendered is either a static literal or a number derived from
 * in-tree data — no user-controlled strings reach the DOM through this
 * component.
 */
import Icon from './Icon';

interface AppHeroProps {
  /** Total number of themes available — usually ~545 once the dataset loads. */
  themeCount: number;
  /** Number of layout templates — sourced from RESUME_TEMPLATES. */
  layoutCount: number;
  /** Number of starter templates in `public/templates/*.md`. */
  templateCount: number;
}

/**
 * Render one statistic in the stat counter row. The number is the loud part
 * (mono, accent), the label is the small-caps kicker.
 */
function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <span className="app-hero__stat">
      <span className="app-hero__stat-value">{value}</span>
      <span className="app-hero__stat-label section-kicker">{label}</span>
    </span>
  );
}

export default function AppHero({ themeCount, layoutCount, templateCount }: AppHeroProps) {
  return (
    <section className="app-hero" aria-label="Welcome to Works on My Resume">
      <div className="app-hero__brand">
        <span className="app-hero__dots" aria-hidden="true">
          <span className="app-hero__dot" />
          <span className="app-hero__dot" />
          <span className="app-hero__dot" />
        </span>
        <span className="app-hero__prompt" aria-hidden="true">
          &rsaquo;_
        </span>
        <h1 className="app-hero__title">Works on My Resume</h1>
      </div>

      <p className="app-hero__tagline">
        A static, local-first Markdown resume renderer. {themeCount} themes, {layoutCount} layouts,
        hash-CSP private. Swap themes with <kbd>&larr;</kbd> <kbd>&rarr;</kbd>, <kbd>/</kbd> to
        search, <kbd>r</kbd> for random.
      </p>

      <div className="app-hero__stats" role="list" aria-label="At a glance">
        <HeroStat value={String(themeCount)} label="Themes" />
        <span className="app-hero__stat-sep" aria-hidden="true">
          ·
        </span>
        <HeroStat value={String(layoutCount)} label="Layouts" />
        <span className="app-hero__stat-sep" aria-hidden="true">
          ·
        </span>
        <HeroStat value={String(templateCount)} label="Templates" />
        <span className="app-hero__stat-sep" aria-hidden="true">
          ·
        </span>
        <span className="app-hero__stat" role="listitem">
          <span className="app-hero__stat-value app-hero__stat-value--icon">
            <Icon name="check" size={18} />
          </span>
          <span className="app-hero__stat-label section-kicker">Offline-ready</span>
        </span>
      </div>
    </section>
  );
}

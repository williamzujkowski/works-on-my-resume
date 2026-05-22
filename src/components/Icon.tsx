/**
 * Icon — a small, consistent set of inline SVG icons for interactive chrome.
 *
 * Replaces the inconsistent raw Unicode glyphs (▾ ‹ › ⤮ ✕ ⚠ ℹ) that used to
 * decorate buttons and notices. Every icon is a 24x24 stroked path on a
 * `currentColor` stroke, so it inherits the control's text color and the
 * focus/hover treatment for free. Genuinely-typographic characters (the `·`
 * separator) are intentionally left as text elsewhere.
 */

export type IconName =
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'shuffle'
  | 'close'
  | 'alert'
  | 'info'
  | 'search'
  | 'check'
  | 'replace'
  | 'trash'
  | 'file'
  | 'help'
  | 'list-numbers'
  | 'wrap-text'
  | 'plus';

interface IconProps {
  name: IconName;
  /** Pixel size of the square viewport. Defaults to 16. */
  size?: number;
  className?: string;
}

/* Each entry is the inner markup of a 24x24 `viewBox` icon. */
const PATHS: Record<IconName, React.ReactNode> = {
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-left': <path d="m15 18-6-6 6-6" />,
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  shuffle: (
    <>
      <path d="M16 3h5v5" />
      <path d="M4 20 21 3" />
      <path d="M21 16v5h-5" />
      <path d="m15 15 6 6" />
      <path d="M4 4l5 5" />
    </>
  ),
  close: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  replace: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 9 15" />
      <path d="M10 20H4v-6" />
      <path d="M4 20 15 9" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </>
  ),
  'list-numbers': (
    <>
      <path d="M10 6h11" />
      <path d="M10 12h11" />
      <path d="M10 18h11" />
      <path d="M4 4v4" />
      <path d="M4 8h1.5" />
      <path d="M3 4h1.5" />
      <path d="M6 14H3l3 4H3" />
    </>
  ),
  'wrap-text': (
    <>
      <path d="M3 6h18" />
      <path d="M3 12h15a3 3 0 0 1 0 6h-4" />
      <path d="m16 16-2 2 2 2" />
      <path d="M3 18h7" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
};

export default function Icon({ name, size = 16, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

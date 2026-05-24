/**
 * ThemeControls — previous / next / random theme buttons, the current theme
 * name with dark/light + contrast indicators, and a "Copy theme link" button.
 *
 * The copied link carries ONLY the theme slug — never resume content — which
 * is the entire reason `?theme=` exists.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ResumeTheme } from '../types';
import { RESUME_SAFE_MIN_CONTRAST } from '../types';
import { wcagLevel } from '../utils/wcag';
import Icon from './Icon';

/**
 * CSP-friendly accent dot. Paints its background color via CSSOM
 * (`el.style.setProperty(...)`) rather than a React `style={...}` attribute,
 * so the document CSP can drop `style-src 'unsafe-inline'` (#38). CSSOM
 * mutations are governed by `script-src`, not `style-src`.
 */
function AccentDot({ className, background }: { className: string; background: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('background-color', background);
  }, [background]);
  return <span ref={ref} className={className} aria-hidden="true" />;
}

interface ThemeControlsProps {
  current: ResumeTheme;
  onPrevious: () => void;
  onNext: () => void;
  onRandom: () => void;
}

export default function ThemeControls({
  current,
  onPrevious,
  onNext,
  onRandom,
}: ThemeControlsProps) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  /** Copy a theme-only link to the clipboard, with brief confirmation. */
  const copyThemeLink = useCallback(async () => {
    const url = `${location.origin}${location.pathname}?theme=${current.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable or denied — fall back to a prompt so the
      // user can still copy the link manually.
      window.prompt('Copy this theme link:', url);
    }
  }, [current.slug]);

  const bodyContrast = current.contrastRatio.toFixed(1);
  const accentContrast = current.contrast.accentOnBg.toFixed(1);
  const isSafe = current.contrastRatio >= RESUME_SAFE_MIN_CONTRAST;
  const bodyLevel = wcagLevel(current.contrastRatio);
  const accentLevel = wcagLevel(current.contrast.accentOnBg);

  /* Full sentences used for both the visual `title` tooltip and the
     `aria-label`, so the bare "15.8:1" figure is never the only context a
     reader (sighted or screen-reader) gets. */
  const bodyLabel = `Body text contrast ${bodyContrast}:1 — WCAG ${bodyLevel}${
    isSafe ? '' : ', below the resume-safe threshold'
  }`;
  const accentLabel = `Accent contrast ${accentContrast}:1 — WCAG ${accentLevel}`;

  return (
    <div className="theme-controls">
      <div className="theme-controls__nav" role="group" aria-label="Step through themes">
        <button
          type="button"
          className="btn btn--icon"
          onClick={onPrevious}
          aria-label="Previous theme"
          title="Previous theme (←)"
        >
          <Icon name="chevron-left" />
        </button>
        <button
          type="button"
          className="btn btn--icon"
          onClick={onNext}
          aria-label="Next theme"
          title="Next theme (→)"
        >
          <Icon name="chevron-right" />
        </button>
        <button
          type="button"
          className="btn btn--icon"
          onClick={onRandom}
          aria-label="Random theme"
          title="Random theme (r)"
        >
          <Icon name="shuffle" />
        </button>
      </div>

      <span className="theme-controls__current">
        <span className={current.isDark ? 'badge badge--dark' : 'badge badge--light'}>
          {current.isDark ? 'dark' : 'light'}
        </span>
        {/* Body-text contrast — the canonical legibility figure. The icon
            (check / alert) plus the explicit aria-label carry the meaning,
            so the signal is never colour-only. */}
        <span
          className={isSafe ? 'badge badge--safe' : 'badge badge--unsafe'}
          title={bodyLabel}
          aria-label={bodyLabel}
        >
          {isSafe ? <Icon name="check" size={12} /> : <Icon name="alert" size={12} />}
          {bodyContrast}:1
        </span>
        {/* Accent contrast — every theme's accent is engine-guaranteed to
            clear WCAG AA, so this is informational rather than a warning. */}
        <span className="badge" title={accentLabel} aria-label={accentLabel}>
          <AccentDot className="theme-controls__accent-dot" background={current.tokens.accent} />
          {accentContrast}:1
        </span>
      </span>

      <button type="button" className="btn" onClick={copyThemeLink}>
        Copy theme link
      </button>
      {copied && (
        <span className="theme-controls__copied" role="status">
          <Icon name="check" size={13} /> Copied
        </span>
      )}
    </div>
  );
}

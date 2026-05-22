/**
 * ThemeControls — previous / next / random theme buttons, the current theme
 * name with dark/light + contrast indicators, and a "Copy theme link" button.
 *
 * The copied link carries ONLY the theme slug — never resume content — which
 * is the entire reason `?theme=` exists.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ResumeTheme } from '../types';
import { RESUME_SAFE_MIN_CONTRAST } from '../types';
import Icon from './Icon';

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

  const contrast = current.contrastRatio.toFixed(1);
  const isSafe = current.contrastRatio >= RESUME_SAFE_MIN_CONTRAST;

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
        <span
          className={isSafe ? 'badge badge--safe' : 'badge badge--unsafe'}
          title={
            isSafe
              ? `Body text contrast ${contrast}:1 — meets the resume-safe threshold`
              : `Body text contrast ${contrast}:1 — below the resume-safe threshold`
          }
        >
          {isSafe ? <Icon name="check" size={12} /> : <Icon name="alert" size={12} />}
          {contrast}:1
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

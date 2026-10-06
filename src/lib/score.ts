export type ScoreLabel = 'Great' | 'Good' | 'Fair' | 'Poor';

/** Single source for score bands, so the label and the page theme always agree. */
export function scoreLabel(score: number): ScoreLabel {
  if (score >= 80) return 'Great';
  if (score >= 65) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Poor';
}

type Rgb = [number, number, number];

export type Theme = {
  backgroundStart: string;
  backgroundEnd: string;
  text: string;
  accent: string;
  /** Cards, inputs and panels: a translucent layer over the gradient. */
  surface: { rgb: Rgb; alpha: number };
  /** Dropdowns, which need to hide what's behind them. */
  surfaceStrong: string;
  border: string;
  placeholder: string;
  error: string;
  /** Tells the browser how to draw native controls (date/time picker icons, scrollbars). */
  colorScheme: 'light' | 'dark';
};

/**
 * Colors per score band. Text, accent and error colors are checked for WCAG
 * 4.5:1 contrast on the surface over both gradient ends (see score.test.ts),
 * so keep that test passing when changing them.
 */
export const THEMES: Record<ScoreLabel, Theme> = {
  Great: {
    backgroundStart: '#2c0a2c', backgroundEnd: '#6d2a49', text: '#ffffff', accent: '#ffcc80',
    surface: { rgb: [0, 0, 0], alpha: 0.18 }, surfaceStrong: 'rgba(28, 6, 28, 0.95)',
    border: 'rgba(255, 255, 255, 0.2)', placeholder: 'rgba(255, 255, 255, 0.75)', error: '#ffd3d3', colorScheme: 'dark',
  },
  Good: {
    backgroundStart: '#0d3b66', backgroundEnd: '#b8432a', text: '#ffffff', accent: '#f4d35e',
    surface: { rgb: [0, 0, 0], alpha: 0.22 }, surfaceStrong: 'rgba(9, 36, 62, 0.95)',
    border: 'rgba(255, 255, 255, 0.22)', placeholder: 'rgba(255, 255, 255, 0.75)', error: '#fff0ea', colorScheme: 'dark',
  },
  Fair: {
    backgroundStart: '#a9c1e0', backgroundEnd: '#f7d08a', text: '#16293a', accent: '#0f1a2b',
    surface: { rgb: [255, 255, 255], alpha: 0.35 }, surfaceStrong: 'rgba(255, 255, 255, 0.95)',
    border: 'rgba(22, 41, 58, 0.3)', placeholder: 'rgba(22, 41, 58, 0.7)', error: '#8a1c1c', colorScheme: 'light',
  },
  Poor: {
    backgroundStart: '#3e4a61', backgroundEnd: '#5d6878', text: '#eef0f3', accent: '#ffffff',
    surface: { rgb: [0, 0, 0], alpha: 0.22 }, surfaceStrong: 'rgba(38, 46, 61, 0.96)',
    border: 'rgba(255, 255, 255, 0.22)', placeholder: 'rgba(255, 255, 255, 0.75)', error: '#ffe6e6', colorScheme: 'dark',
  },
};

function cssVariables(theme: Theme): Record<string, string> {
  const { rgb, alpha } = theme.surface;
  return {
    '--background-start': theme.backgroundStart,
    '--background-end': theme.backgroundEnd,
    '--text-primary': theme.text,
    '--text-accent': theme.accent,
    '--surface': `rgba(${rgb.join(', ')}, ${alpha})`,
    '--surface-strong': theme.surfaceStrong,
    '--border': theme.border,
    '--placeholder': theme.placeholder,
    '--error': theme.error,
    'color-scheme': theme.colorScheme,
  };
}

/** Browser/OS chrome (address bar, PWA title bar) follows the top of the gradient. */
function setThemeColor(color: string) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
}

/** Apply the page theme (CSS custom properties) for a score. */
export function applyScoreTheme(score: number, root: HTMLElement = document.documentElement) {
  const theme = THEMES[scoreLabel(Number(score) || 0)];
  for (const [prop, value] of Object.entries(cssVariables(theme))) {
    root.style.setProperty(prop, value);
  }
  setThemeColor(theme.backgroundStart);
}

/** Back to the neutral theme in app.css (e.g. when starting a new search). */
export function resetScoreTheme(root: HTMLElement = document.documentElement) {
  for (const prop of Object.keys(cssVariables(THEMES.Poor))) root.style.removeProperty(prop);
  setThemeColor(THEMES.Poor.backgroundStart);
}

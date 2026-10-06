export type ScoreLabel = 'Great' | 'Good' | 'Fair' | 'Poor';

/** Single source for score bands, so the label and the page theme always agree. */
export function scoreLabel(score: number): ScoreLabel {
  if (score >= 80) return 'Great';
  if (score >= 65) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Poor';
}

const THEMES: Record<ScoreLabel, Record<string, string>> = {
  Great: { '--background-start': '#2c0a2c', '--background-end': '#6d2a49', '--text-primary': '#ffffff', '--text-accent': '#ffcc80' },
  Good: { '--background-start': '#0d3b66', '--background-end': '#f95738', '--text-primary': '#ffffff', '--text-accent': '#f4d35e' },
  Fair: { '--background-start': '#4a6fa5', '--background-end': '#f7d08a', '--text-primary': '#16293a', '--text-accent': '#0f1a2b' },
  Poor: { '--background-start': '#3e4a61', '--background-end': '#939fab', '--text-primary': '#e0e0e0', '--text-accent': '#ffffff' },
};

/** Apply the page theme (CSS custom properties) for a score. */
export function applyScoreTheme(score: number, root: HTMLElement = document.documentElement) {
  for (const [prop, value] of Object.entries(THEMES[scoreLabel(Number(score) || 0)])) {
    root.style.setProperty(prop, value);
  }
}

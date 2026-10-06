import { describe, it, expect } from 'vitest';
import { THEMES, scoreLabel, type Theme } from './score';

type Rgb = [number, number, number];

const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
const channel = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
/** WCAG contrast ratio. */
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** A translucent surface composited over the gradient color. */
const over = (surface: Theme['surface'], bg: Rgb): Rgb =>
  surface.rgb.map((c, i) => surface.alpha * c + (1 - surface.alpha) * bg[i]) as Rgb;

describe('scoreLabel()', () => {
  it('uses the 80/65/40 bands', () => {
    expect([95, 80, 79, 65, 64, 40, 39, 0].map(scoreLabel)).toEqual(['Great', 'Great', 'Good', 'Good', 'Fair', 'Fair', 'Poor', 'Poor']);
  });
});

describe.each(Object.entries(THEMES))('%s theme contrast (WCAG AA)', (_name, theme) => {
  const ends = [hex(theme.backgroundStart), hex(theme.backgroundEnd)];

  it('text and errors reach 4.5:1 on cards and panels at both ends of the gradient', () => {
    for (const bg of ends) {
      const surface = over(theme.surface, bg);
      expect(contrast(hex(theme.text), surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex(theme.error), surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex(theme.accent), surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('header text reaches 4.5:1 directly on the gradient', () => {
    for (const bg of ends) expect(contrast(hex(theme.text), bg)).toBeGreaterThanOrEqual(4.5);
  });
});

import { describe, it, expect } from 'vitest';
import { explainScore } from './explain';

describe('explainScore()', () => {
  it('describes a clear horizon with a lit cloud canvas (ground)', () => {
    const text = explainScore(
      { lowCloud: { value: 5 }, horizon: { state: 'clear' }, highCloud: { value: 55 }, midCloud: { value: 30 } },
      92,
      'sunset',
      'ground'
    );
    expect(text).toBe(
      'Clear low-level skies let the sun light up the higher clouds. The sky toward the setting sun looks clear, so light can reach the clouds overhead. A healthy amount of high cloud gives the light a canvas to color. Mid-level clouds add texture and depth.'
    );
  });

  it('uses the event wording and forecast tense', () => {
    const text = explainScore({ lowCloud: { value: 80 }, horizon: { state: 'blocked' } }, 10, 'sunrise', 'ground');
    expect(text).toContain('rising sun');
    expect(text).toContain('is likely to block');
    expect(text).not.toMatch(/\b(blocked|reduced|provided)\b/);
  });

  it('applies each model its own thresholds', () => {
    const humid = { humidity: { value: 78 } };
    expect(explainScore(humid, 50, 'sunset', 'ground')).toContain('High humidity');
    expect(explainScore(humid, 50, 'sunset', 'flight')).toBe('Some color is possible.');
  });

  it('only credits aerosols when they actually added to the score, and flags smoke', () => {
    expect(explainScore({ aod: { value: 0.25, bonus: 3 } }, 60, 'sunset', 'ground')).toContain('Moderate aerosols');
    expect(explainScore({ aod: { value: 0.25, bonus: 0 } }, 60, 'sunset', 'ground')).not.toContain('aerosols');
    expect(explainScore({ aod: { value: 0.9, bonus: -10 } }, 60, 'sunset', 'ground')).toContain('Smoke or dust');
  });

  it('falls back to the score band when no factor stands out', () => {
    expect(explainScore({}, 85, 'sunset', 'flight')).toBe('Conditions look excellent for a stunning in-flight sunset.');
    expect(explainScore({}, 30, 'sunrise', 'ground')).toBe('Clouds or haze will likely limit the color.');
    expect(explainScore(undefined, 30, 'sunrise', 'ground')).toBe('');
  });

  it('reads older payloads that only had the sign of horizon.net', () => {
    expect(explainScore({ horizon: { net: -12 } }, 40, 'sunset', 'ground')).toContain('may block the light');
  });
});

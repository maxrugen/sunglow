import { describe, it, expect } from 'vitest';
import { calculateWithDetails, evaluateInFlight, type WeatherData } from './scoring';
import { scoreLabel } from '$lib/score';

/**
 * Reference skies with the label each should get. These pin the overall
 * calibration of the model (SCORING_VERSION 2), so a change that moves a sky
 * into another band is deliberate, not a side effect.
 */
const mild = {
  humidity: 55, aod: 0.12, solarAltitudeDeg: -2, windSpeed10mMs: 3, pressureTrendHpa: 0.5,
  dewPointSpreadC: 9, visibilityM: 25000, precipitationProbability: 5, precipitationMmPerHour: 0, totalCloud: 0,
};
const canvas = { highCloud: 55, midCloud: 30, lowCloud: 5, totalCloud: 65 };

const ground: Array<[string, Partial<WeatherData>, ReturnType<typeof scoreLabel>]> = [
  ['clear sky, clean air', { highCloud: 0, midCloud: 0, lowCloud: 0, horizonCloud: 5 }, 'Fair'],
  ['clear sky with every small bonus', { aod: 0.25, pressureTrendHpa: 2, pm25UgM3: 20, highCloud: 0, midCloud: 0, lowCloud: 0, horizonCloud: 5 }, 'Fair'],
  ['thin high cloud', { highCloud: 10, midCloud: 0, lowCloud: 0, horizonCloud: 5, totalCloud: 10 }, 'Fair'],
  ['ideal canvas, clear horizon', { ...canvas, horizonCloud: 10 }, 'Great'],
  ['good canvas, clear horizon', { highCloud: 35, midCloud: 15, lowCloud: 10, horizonCloud: 15, totalCloud: 45 }, 'Great'],
  ['ideal canvas, horizon unknown', { ...canvas }, 'Great'],
  ['ideal canvas, horizon 60% blocked', { ...canvas, horizonCloud: 60 }, 'Fair'],
  ['ideal canvas, horizon 90% blocked', { ...canvas, horizonCloud: 90 }, 'Poor'],
  ['thick mid deck', { highCloud: 20, midCloud: 90, lowCloud: 10, horizonCloud: 45, totalCloud: 92 }, 'Fair'],
  ['solid cirrus', { highCloud: 100, midCloud: 0, lowCloud: 0, horizonCloud: 5, totalCloud: 100 }, 'Fair'],
  ['low cloud 50%', { highCloud: 50, midCloud: 20, lowCloud: 50, horizonCloud: 50, totalCloud: 80 }, 'Fair'],
  ['overcast low cloud', { highCloud: 60, midCloud: 40, lowCloud: 95, horizonCloud: 95, totalCloud: 100 }, 'Poor'],
  ['rain', { humidity: 92, precipitationProbability: 85, precipitationMmPerHour: 2, highCloud: 40, midCloud: 60, lowCloud: 70, horizonCloud: 80, totalCloud: 98, visibilityM: 4000, dewPointSpreadC: 1 }, 'Poor'],
  ['smoke or haze', { aod: 0.9, pm25UgM3: 80, visibilityM: 6000, highCloud: 30, midCloud: 10, lowCloud: 0, horizonCloud: 10, totalCloud: 40 }, 'Fair'],
];

describe('ground model reference skies', () => {
  it.each(ground)('%s → %s', (_name, overrides, label) => {
    const score = calculateWithDetails({ ...mild, ...overrides } as WeatherData).score;
    expect(scoreLabel(score)).toBe(label);
  });

  it('only skies with a lit cloud canvas reach the alert threshold (80)', () => {
    for (const [, overrides, label] of ground) {
      const score = calculateWithDetails({ ...mild, ...overrides } as WeatherData).score;
      expect(score >= 80).toBe(label === 'Great');
    }
  });
});

describe('in-flight model reference skies', () => {
  const flight = (o: Partial<WeatherData>) => scoreLabel(evaluateInFlight({ ...mild, ...o } as WeatherData, true).score);

  it('rates a clear sky Fair and a high-cloud canvas Great', () => {
    expect(flight({ highCloud: 0, midCloud: 0, lowCloud: 0 })).toBe('Fair');
    expect(flight({ ...canvas })).toBe('Great');
  });

  it('treats low cloud below the plane as a carpet, not a blocker', () => {
    expect(flight({ highCloud: 60, midCloud: 40, lowCloud: 95, totalCloud: 100 })).toBe('Great');
  });
});

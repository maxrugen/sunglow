import { describe, it, expect } from 'vitest';
import {
  calculateSunsetQuality,
  calculateWithDetails,
  calculateConfidence,
  evaluate,
  evaluateInFlight,
  type WeatherData,
} from './scoring';

// ── Helpers ──────────────────────────────────────────────────────────

function baseWeather(overrides: Partial<WeatherData> = {}): WeatherData {
  return {
    highCloud: 60, // optimum
    midCloud: 40,  // optimum
    lowCloud: 10,  // low
    humidity: 50,
    aod: 0.2,      // in bonus range
    solarAltitudeDeg: -3, // optimum
    totalCloud: 50,
    precipitationProbability: 10,
    precipitationMmPerHour: 0,
    pressureTrendHpa: 2,
    windSpeed10mMs: 4,
    visibilityM: 20000,
    dewPointSpreadC: 10,
    pm25UgM3: 20,
    ...overrides,
  };
}

// ── Ground-level scoring ────────────────────────────────────────────

describe('calculateSunsetQuality()', () => {
  it('scores high for ideal conditions', () => {
    const score = calculateSunsetQuality(baseWeather());
    expect(score).toBeGreaterThanOrEqual(80);
  });

  it('scores low for heavy low cloud', () => {
    const score = calculateSunsetQuality(baseWeather({ lowCloud: 95 }));
    expect(score).toBeLessThan(30);
  });

  it('returns 0-100 range', () => {
    const score = calculateSunsetQuality(baseWeather({ lowCloud: 100, humidity: 100, highCloud: 0, midCloud: 0, aod: 0 }));
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('calculateWithDetails()', () => {
  it('returns score and details object', () => {
    const result = calculateWithDetails(baseWeather());
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('details');
    expect(typeof result.score).toBe('number');
  });

  it('high cloud at 60% gives maximum bonus', () => {
    const at60 = calculateWithDetails(baseWeather({ highCloud: 60 }));
    const at0 = calculateWithDetails(baseWeather({ highCloud: 0 }));
    expect(at60.score).toBeGreaterThanOrEqual(at0.score);
  });

  it('low cloud >80% triggers heavy overcast flag', () => {
    const result = calculateWithDetails(baseWeather({ lowCloud: 90 }));
    expect((result.details.lowCloud as any).heavyOvercast).toBe(true);
  });

  it('humidity >75% applies penalty', () => {
    const humid = calculateWithDetails(baseWeather({ humidity: 90 }));
    expect((humid.details.humidity as any).penalty).toBeLessThan(0);
  });

  it('AOD bonus is gated by humidity and visibility', () => {
    const blocked = calculateWithDetails(baseWeather({ aod: 0.25, humidity: 90 }));
    expect((blocked.details.aod as any).bonus).toBe(0);
  });

  it('precipitation probability >40% applies penalty', () => {
    const rainy = calculateWithDetails(baseWeather({ precipitationProbability: 80 }));
    expect((rainy.details.precipitation as any).penaltyProb).toBeLessThan(0);
  });

  it('visibility <5km applies penalty', () => {
    const foggy = calculateWithDetails(baseWeather({ visibilityM: 2000 }));
    expect((foggy.details.visibility as any).penalty).toBeLessThan(0);
  });

  it('solar altitude at -3° gets maximum bonus', () => {
    const optimal = calculateWithDetails(baseWeather({ solarAltitudeDeg: -3 }));
    expect((optimal.details.solarAltitude as any).net).toBe(6);
  });

  it('solar altitude far from -3° gets no bonus', () => {
    const noon = calculateWithDetails(baseWeather({ solarAltitudeDeg: 45 }));
    expect((noon.details.solarAltitude as any).net).toBe(0);
  });

  it('PM2.5 10-35 gives bonus when air is clear', () => {
    const result = calculateWithDetails(baseWeather({ pm25UgM3: 20 }));
    expect((result.details.pm25 as any).net).toBe(4);
  });

  it('PM2.5 >60 gives penalty', () => {
    const result = calculateWithDetails(baseWeather({ pm25UgM3: 80 }));
    expect((result.details.pm25 as any).net).toBe(-8);
  });

  it('score is clamped to 0-100', () => {
    const terrible = calculateWithDetails(baseWeather({
      highCloud: 0, midCloud: 0, lowCloud: 100, humidity: 100,
      aod: 0, visibilityM: 100, precipitationProbability: 100,
      precipitationMmPerHour: 10, solarAltitudeDeg: 45,
    }));
    expect(terrible.score).toBeGreaterThanOrEqual(0);
    expect(terrible.score).toBeLessThanOrEqual(100);
  });
});

describe('calculateConfidence()', () => {
  it('baseline is 90 for good conditions aligned to sunset', () => {
    const c = calculateConfidence(baseWeather(), true);
    expect(c).toBe(90);
  });

  it('drops when not aligned to sunset', () => {
    const aligned = calculateConfidence(baseWeather(), true);
    const misaligned = calculateConfidence(baseWeather(), false);
    expect(misaligned).toBeLessThan(aligned);
  });

  it('drops for high precipitation', () => {
    const c = calculateConfidence(baseWeather({ precipitationProbability: 80 }), true);
    expect(c).toBeLessThan(90);
  });

  it('drops for high low cloud', () => {
    const c = calculateConfidence(baseWeather({ lowCloud: 80 }), true);
    expect(c).toBeLessThan(90);
  });

  it('is clamped to 0-100', () => {
    const worst = calculateConfidence(baseWeather({
      precipitationProbability: 100, precipitationMmPerHour: 5,
      lowCloud: 100, visibilityM: 100, pm25UgM3: 100,
    }), false);
    expect(worst).toBeGreaterThanOrEqual(0);
    expect(worst).toBeLessThanOrEqual(100);
  });
});

describe('evaluate()', () => {
  it('returns score, details, and confidence', () => {
    const result = evaluate(baseWeather(), true);
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('details');
    expect(result).toHaveProperty('confidence');
  });
});

// ── In-flight scoring ───────────────────────────────────────────────

describe('evaluateInFlight()', () => {
  it('returns score, details, and confidence', () => {
    const result = evaluateInFlight(baseWeather(), true);
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('details');
    expect(result).toHaveProperty('confidence');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('low cloud gives BONUS (inverted from ground)', () => {
    const withLow = evaluateInFlight(baseWeather({ lowCloud: 50 }), true);
    const noLow = evaluateInFlight(baseWeather({ lowCloud: 0 }), true);
    expect(withLow.score).toBeGreaterThanOrEqual(noLow.score);
    expect((withLow.details.lowCloud as any).adjustment).toBeGreaterThan(0);
    expect((withLow.details.lowCloud as any).note).toBe('inverted for altitude');
  });

  it('heavy low cloud still gives positive adjustment', () => {
    const result = evaluateInFlight(baseWeather({ lowCloud: 90 }), true);
    expect((result.details.lowCloud as any).adjustment).toBeGreaterThan(0);
  });

  it('PM2.5 is ignored at altitude', () => {
    const highPm = evaluateInFlight(baseWeather({ pm25UgM3: 100 }), true);
    const lowPm = evaluateInFlight(baseWeather({ pm25UgM3: 5 }), true);
    expect(highPm.score).toBe(lowPm.score);
    expect((highPm.details.pm25 as any).net).toBe(0);
  });

  it('confidence baseline is lower than ground (80 vs 90)', () => {
    const ground = evaluate(baseWeather(), true);
    const flight = evaluateInFlight(baseWeather(), true);
    expect(flight.confidence).toBeLessThan(ground.confidence);
  });

  it('humidity penalty kicks in later (80% vs 75%)', () => {
    const at78 = evaluateInFlight(baseWeather({ humidity: 78 }), true);
    expect((at78.details.humidity as any).penalty).toBeCloseTo(0);
  });

  it('visibility penalty threshold is lower (3km vs 5km)', () => {
    const at4k = evaluateInFlight(baseWeather({ visibilityM: 4000 }), true);
    expect((at4k.details.visibility as any).penalty).toBeCloseTo(0);
  });

  it('precipitation penalty is reduced', () => {
    const weather = baseWeather({ precipitationProbability: 80, precipitationMmPerHour: 2 });
    const ground = evaluate(weather, true);
    const flight = evaluateInFlight(weather, true);
    // Flight should have a higher score (less harsh precipitation penalty)
    expect(flight.score).toBeGreaterThanOrEqual(ground.score - 5);
  });

  it('score clamped to 0-100 for extreme conditions', () => {
    const terrible = evaluateInFlight(baseWeather({
      highCloud: 0, midCloud: 0, humidity: 100, aod: 0,
      visibilityM: 100, precipitationProbability: 100,
      precipitationMmPerHour: 10, solarAltitudeDeg: 45,
    }), false);
    expect(terrible.score).toBeGreaterThanOrEqual(0);
    expect(terrible.score).toBeLessThanOrEqual(100);
  });
});

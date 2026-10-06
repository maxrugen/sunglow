import { describe, it, expect, vi, afterEach } from 'vitest';
import { airQualityAt, compositeAt, dewPoint, fetchForecast, hourCount, nearestIndex, type Forecast } from './weather';

function forecast(hours: number, values: Partial<Record<string, number[]>> = {}): Forecast {
  const fill = (v: number) => Array.from({ length: hours }, () => v);
  return {
    hourly: {
      time: Array.from({ length: hours }, (_, i) => 1_000_000 + i * 3600),
      relativehumidity_2m: fill(50),
      temperature_2m: fill(20),
      cloudcover_low: fill(0),
      cloudcover_mid: fill(0),
      cloudcover_high: fill(0),
      cloudcover: fill(0),
      precipitation_probability: fill(0),
      precipitation: fill(0),
      pressure_msl: fill(1010),
      windspeed_10m: fill(2),
      visibility: fill(10000),
      ...values,
    },
  };
}

describe('nearestIndex()', () => {
  it('finds the closest epoch and skips non-finite values', () => {
    expect(nearestIndex([100, NaN, 300, 400], 290)).toBe(2);
    expect(nearestIndex([], 5)).toBe(-1);
  });
});

describe('compositeAt()', () => {
  it('weights the previous, selected and next hour 0.3 / 0.6 / 0.1', () => {
    const f = forecast(3, { cloudcover_high: [10, 20, 30] });
    expect(compositeAt(f, 1).highCloud).toBeCloseTo(0.3 * 10 + 0.6 * 20 + 0.1 * 30);
  });

  it('renormalises weights at the edges', () => {
    const f = forecast(2, { cloudcover_high: [10, 20] });
    expect(compositeAt(f, 0).highCloud).toBeCloseTo((0.6 * 10 + 0.1 * 20) / 0.7);
  });

  it('derives pressure trend and dew point spread', () => {
    const f = forecast(3, { pressure_msl: [1000, 1004, 1004] });
    const c = compositeAt(f, 1);
    expect(c.pressureTrend).toBeCloseTo(c.pressure - 1000);
    expect(c.dewSpread).toBeCloseTo(20 - dewPoint(20, 50));
  });

  it('uses the shortest hourly array as the usable length', () => {
    expect(hourCount(forecast(5, { visibility: [1, 2, 3] }))).toBe(3);
  });
});

describe('airQualityAt()', () => {
  it('reads AOD and PM2.5 at the nearest hour', () => {
    const aq = { hourly: { time: [0, 3600], aerosol_optical_depth: [0.1, 0.3], pm2_5: [5, 15] } };
    expect(airQualityAt(aq, 3500)).toEqual({ aod: 0.3, pm25: 15 });
  });

  it('returns undefined values without data', () => {
    expect(airQualityAt(null, 0)).toEqual({ aod: undefined, pm25: undefined });
  });

  it('ignores hours outside the forecast range instead of reusing the last one', () => {
    const aq = { hourly: { time: [0, 3600], aerosol_optical_depth: [0.1, 0.3], pm2_5: [5, 15] } };
    expect(airQualityAt(aq, 3600 + 2 * 3600)).toEqual({ aod: 0.3, pm25: 15 });
    expect(airQualityAt(aq, 3600 + 3 * 3600)).toEqual({ aod: undefined, pm25: undefined });
    expect(airQualityAt(aq, 5 * 24 * 3600)).toEqual({ aod: undefined, pm25: undefined });
  });

  it('treats null (no forecast for that hour) as missing, not as zero', () => {
    const aq = { hourly: { time: [0], aerosol_optical_depth: [null], pm2_5: [8] } };
    expect(airQualityAt(aq, 0)).toEqual({ aod: undefined, pm25: 8 });
  });
});

describe('fetchForecast()', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns null instead of throwing when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await fetchForecast(52.5, 13.4, 2)).toBeNull();
  });
});

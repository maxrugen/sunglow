import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SunCalc from 'suncalc';
import { predictSunset } from './prediction';

// New York, 2026-06-10: local midnight is 04:00Z, sunset ≈ 00:30Z on the 11th.
const NYC = { latitude: 40.71, longitude: -74.0 };
const START_SEC = Date.UTC(2026, 5, 10, 4) / 1000;
const HOURS = Array.from({ length: 24 }, (_, i) => START_SEC + i * 3600);

function forecastResponse() {
  const fill = (v: number) => HOURS.map(() => v);
  return {
    utc_offset_seconds: -4 * 3600,
    hourly: {
      time: HOURS,
      relativehumidity_2m: fill(50),
      temperature_2m: fill(22),
      cloudcover_low: fill(5),
      cloudcover_mid: fill(30),
      cloudcover_high: fill(50),
      cloudcover: fill(60),
      precipitation_probability: fill(0),
      precipitation: fill(0),
      pressure_msl: fill(1015),
      windspeed_10m: fill(3),
      visibility: fill(20000),
    },
    daily: { sunset: [] },
  };
}

function airQualityResponse() {
  return {
    hourly: {
      time: HOURS,
      aerosol_optical_depth: HOURS.map(() => 0.25),
      pm2_5: HOURS.map(() => 12),
    },
  };
}

const fetchMock = vi.fn(async (url: string) => {
  const body = url.includes('air-quality') ? airQualityResponse() : forecastResponse();
  return new Response(JSON.stringify(body), { status: 200 });
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-10T15:00:00Z'));
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('predictSunset()', () => {
  it('scores the hour nearest the real (UTC) sunset', async () => {
    const payload = await predictSunset(NYC);
    const sunsetSec = SunCalc.getTimes(new Date(), NYC.latitude, NYC.longitude).sunset.getTime() / 1000;

    expect(Math.abs(payload.used.epochSec - sunsetSec)).toBeLessThanOrEqual(1800);
    expect(payload.weatherData.solarAltitudeDeg).toBeGreaterThan(-8);
    expect(payload.weatherData.solarAltitudeDeg).toBeLessThan(5);
  });

  it('takes AOD from the air-quality API', async () => {
    const payload = await predictSunset({ latitude: 40.72, longitude: -74.0 });
    expect(payload.weatherData.aod).toBeCloseTo(0.25);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('aerosol_optical_depth'))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('daily=aerosol'))).toBe(false);
  });

  it('serves repeat lookups from the cache without refetching', async () => {
    const coords = { latitude: 40.73, longitude: -74.0 };
    await predictSunset(coords);
    const callsAfterFirst = fetchMock.mock.calls.length;
    await predictSunset(coords);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SunCalc from 'suncalc';
import { nextEvent, predictEvent, roundCoord } from './prediction';

// New York, 2026-06-10: local midnight is 04:00Z, sunset ≈ 00:30Z on the 11th.
const NYC = { latitude: 40.71, longitude: -74.0 };
const START_SEC = Date.UTC(2026, 5, 10, 4) / 1000;
// Two days, matching forecast_days=2.
const HOURS = Array.from({ length: 48 }, (_, i) => START_SEC + i * 3600);

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

// Horizon samples: 80% low cloud toward the sun.
function horizonResponse() {
  return [0, 1, 2].map(() => ({
    hourly: { time: HOURS, cloudcover_low: HOURS.map(() => 80), cloudcover_mid: HOURS.map(() => 0) },
  }));
}

const fetchMock = vi.fn(async (url: string) => {
  const multiPoint = /latitude=[^&]*%2C/.test(url);
  const body = url.includes('air-quality') ? airQualityResponse() : multiPoint ? horizonResponse() : forecastResponse();
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

describe('predictEvent() for sunset', () => {
  it('scores the hour nearest the real (UTC) sunset', async () => {
    const payload = await predictEvent({ ...NYC, event: 'sunset' });
    const sunsetSec = SunCalc.getTimes(new Date(), NYC.latitude, NYC.longitude).sunset.getTime() / 1000;

    expect(Math.abs(payload.used.epochSec - sunsetSec)).toBeLessThanOrEqual(1800);
    expect(payload.weatherData.solarAltitudeDeg).toBeGreaterThan(-8);
    expect(payload.weatherData.solarAltitudeDeg).toBeLessThan(5);
  });

  it('takes AOD from the air-quality API', async () => {
    const payload = await predictEvent({ latitude: 40.72, longitude: -74.0, event: 'sunset' });
    expect(payload.weatherData.aod).toBeCloseTo(0.25);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('aerosol_optical_depth'))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('daily=aerosol'))).toBe(false);
  });

  it('includes clouds toward the setting sun in the score', async () => {
    const payload = await predictEvent({ latitude: 40.75, longitude: -74.0, event: 'sunset' });
    expect(payload.weatherData.horizonCloud).toBeCloseTo(80);
    expect(payload.weatherData.horizonAzimuthDeg).toBeGreaterThan(270);
    expect((payload.explanation.factors.horizon as { net: number }).net).toBeLessThan(0);
  });

  it('serves repeat lookups from the cache without refetching', async () => {
    const coords = { latitude: 40.73, longitude: -74.0 };
    await predictEvent({ ...coords, event: 'sunset' });
    const callsAfterFirst = fetchMock.mock.calls.length;
    await predictEvent({ ...coords, event: 'sunset' });
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('scores tomorrow once tonight\'s afterglow has passed', async () => {
    // 02:00Z on the 11th is 22:00 EDT on the 10th, ~1.5 h after sunset.
    vi.setSystemTime(new Date('2026-06-11T02:00:00Z'));
    const coords = { latitude: 40.74, longitude: -74.0 };
    const payload = await predictEvent({ ...coords, event: 'sunset' });
    const tomorrow = SunCalc.getTimes(new Date('2026-06-11T16:00:00Z'), coords.latitude, coords.longitude).sunset;

    expect(payload.day).toBe('tomorrow');
    expect(payload.timings.eventEpochSec).toBe(Math.floor(tomorrow.getTime() / 1000));
    expect(Math.abs(payload.used.epochSec - tomorrow.getTime() / 1000)).toBeLessThanOrEqual(1800);
  });
});

describe('nextEvent() for sunset', () => {
  it('keeps tonight during the afterglow', () => {
    const sunset = SunCalc.getTimes(new Date('2026-06-10T16:00:00Z'), NYC.latitude, NYC.longitude).sunset;
    const now = new Date(sunset.getTime() + 20 * 60 * 1000);
    expect(nextEvent(now, NYC.latitude, NYC.longitude, 'sunset').day).toBe('today');
  });

  it('has no sunset during polar day', () => {
    const r = nextEvent(new Date('2026-06-21T12:00:00Z'), 78.2, 15.6, 'sunset'); // Svalbard
    expect(r.time).toBeNull();
    expect(r.day).toBe('today');
  });
});

describe('nextEvent()', () => {
  const MADRID = { lat: 40.42, lon: -3.7 };
  const at = (iso: string, lat: number, lon: number, event: 'sunset' | 'sunrise') =>
    nextEvent(new Date(iso), lat, lon, event);
  const sunTimes = (iso: string, lat: number, lon: number) => SunCalc.getTimes(new Date(iso), lat, lon);

  it("treats this morning's sunrise as today after local midnight", () => {
    // 01:00 CEST on 16 June: SunCalc alone returns the 15 June sunrise.
    const r = at('2026-06-15T23:00:00Z', MADRID.lat, MADRID.lon, 'sunrise');
    expect(r.time?.toISOString()).toBe(sunTimes('2026-06-16T12:00:00Z', MADRID.lat, MADRID.lon).sunrise.toISOString());
    expect(r.day).toBe('today');
  });

  it("treats tonight's sunset as today after local midnight", () => {
    const r = at('2026-06-15T23:00:00Z', MADRID.lat, MADRID.lon, 'sunset');
    expect(r.time?.toISOString()).toBe(sunTimes('2026-06-16T12:00:00Z', MADRID.lat, MADRID.lon).sunset.toISOString());
    expect(r.day).toBe('today');
  });

  it('keeps a sunrise for 15 minutes, then moves to tomorrow', () => {
    const sunrise = sunTimes('2026-06-16T12:00:00Z', MADRID.lat, MADRID.lon).sunrise.getTime();
    const during = nextEvent(new Date(sunrise + 10 * 60 * 1000), MADRID.lat, MADRID.lon, 'sunrise');
    const after = nextEvent(new Date(sunrise + 20 * 60 * 1000), MADRID.lat, MADRID.lon, 'sunrise');
    expect(during.time?.getTime()).toBe(sunrise);
    expect(during.day).toBe('today');
    expect(after.time!.getTime() - sunrise).toBeGreaterThan(23 * 3600 * 1000);
    expect(after.day).toBe('tomorrow');
  });

  it('finds the next sunrise at high latitude in May', () => {
    // Tromsø, 00:30 local on 11 May; SunCalc(now) returns the 10 May sunrise.
    const r = at('2026-05-10T22:30:00Z', 69.65, 18.96, 'sunrise');
    expect(r.time?.toISOString()).toBe(sunTimes('2026-05-11T10:00:00Z', 69.65, 18.96).sunrise.toISOString());
    expect(r.day).toBe('today');
  });

  it('uses the morning golden hour end for sunrise', () => {
    const r = at('2026-06-15T23:00:00Z', MADRID.lat, MADRID.lon, 'sunrise');
    expect(r.goldenHour!.getTime()).toBeGreaterThan(r.time!.getTime());
  });

  it('has no sunrise during polar day', () => {
    const r = at('2026-06-21T12:00:00Z', 78.2, 15.6, 'sunrise');
    expect(r.time).toBeNull();
  });
});

describe('predictEvent() for sunrise', () => {
  it('scores the hour nearest the next sunrise and samples the eastern horizon', async () => {
    // 15:00Z is 11:00 EDT, so the next sunrise is tomorrow morning.
    const coords = { latitude: 40.76, longitude: -74.0 };
    const payload = await predictEvent({ ...coords, event: 'sunrise' });
    const sunrise = SunCalc.getTimes(new Date('2026-06-11T12:00:00Z'), coords.latitude, coords.longitude).sunrise;

    expect(payload.event).toBe('sunrise');
    expect(payload.day).toBe('tomorrow');
    expect(payload.timings.eventEpochSec).toBe(Math.floor(sunrise.getTime() / 1000));
    expect(Math.abs(payload.used.epochSec - sunrise.getTime() / 1000)).toBeLessThanOrEqual(1800);
    expect(payload.weatherData.horizonAzimuthDeg).toBeGreaterThan(50);
    expect(payload.weatherData.horizonAzimuthDeg).toBeLessThan(130);
  });

  it('caches sunrise and sunset separately', async () => {
    const coords = { latitude: 40.77, longitude: -74.0 };
    await predictEvent({ ...coords, event: 'sunset' });
    const afterSunset = fetchMock.mock.calls.length;
    await predictEvent({ ...coords, event: 'sunrise' });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterSunset);
  });
});

describe('coordinate rounding', () => {
  it('rounds to two decimals', () => {
    expect(roundCoord(52.5243)).toBe(52.52);
    expect(roundCoord(-74.0059)).toBe(-74.01);
  });

  it('serves nearby coordinates from one cache entry', async () => {
    await predictEvent({ latitude: 40.8012, longitude: -73.9988, event: 'sunset' });
    const calls = fetchMock.mock.calls.length;
    const payload = await predictEvent({ latitude: 40.8049, longitude: -74.0012, event: 'sunset' });
    expect(fetchMock.mock.calls.length).toBe(calls);
    expect(payload.used).toMatchObject({ latitude: 40.8, longitude: -74 });
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import SunCalc from 'suncalc';
import { destinationPoint, fetchHorizon, horizonBlocking, sunAzimuth } from './horizon';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('destinationPoint()', () => {
  it('moves one degree east along the equator in ~111 km', () => {
    const p = destinationPoint(0, 0, 90, 111.195);
    expect(p.lat).toBeCloseTo(0, 5);
    expect(p.lon).toBeCloseTo(1, 3);
  });

  it('wraps across the antimeridian', () => {
    const p = destinationPoint(0, 179.5, 90, 111.195);
    expect(p.lon).toBeCloseTo(-179.5, 3);
  });
});

describe('sunAzimuth()', () => {
  it('points roughly west at an equinox sunset and north-west at a June sunset', () => {
    const berlin = { lat: 52.52, lon: 13.4 };
    const march = SunCalc.getTimes(new Date('2026-03-20T12:00:00Z'), berlin.lat, berlin.lon).sunset;
    const june = SunCalc.getTimes(new Date('2026-06-21T12:00:00Z'), berlin.lat, berlin.lon).sunset;
    expect(sunAzimuth(march, berlin.lat, berlin.lon)).toBeGreaterThan(265);
    expect(sunAzimuth(march, berlin.lat, berlin.lon)).toBeLessThan(275);
    expect(sunAzimuth(june, berlin.lat, berlin.lon)).toBeGreaterThan(300);
    expect(sunAzimuth(june, berlin.lat, berlin.lon)).toBeLessThan(320);
  });
});

describe('horizonBlocking()', () => {
  it('weights the 150 km sample most and counts half of mid cloud', () => {
    const blocking = horizonBlocking([
      { km: 50, lowCloud: 0, midCloud: 0 },
      { km: 150, lowCloud: 100, midCloud: 0 },
      { km: 300, lowCloud: 0, midCloud: 40 },
    ]);
    expect(blocking).toBeCloseTo(0.4 * 100 + 0.35 * 20);
  });

  it('caps each sample at 100%', () => {
    const full = { lowCloud: 100, midCloud: 100 };
    expect(horizonBlocking([{ km: 50, ...full }, { km: 150, ...full }, { km: 300, ...full }])).toBe(100);
  });
});

describe('fetchHorizon()', () => {
  const sunset = new Date('2026-06-10T19:30:00Z');
  const times = [Date.UTC(2026, 5, 10, 19) / 1000, Date.UTC(2026, 5, 10, 20) / 1000];

  it('samples three points toward the sun in one request', async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      new Response(
        JSON.stringify([60, 60, 60].map((low) => ({ hourly: { time: times, cloudcover_low: [low, low], cloudcover_mid: [0, 0] } }))),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const h = await fetchHorizon(52.52, 13.4, sunset);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/latitude=[^&]+%2C[^&]+%2C/);
    expect(h?.samples).toHaveLength(3);
    expect(h?.blockingPct).toBeCloseTo(60);
    // Samples lie west/north-west of Berlin in June.
    expect(h!.samples.every((s) => s.lon < 13.4)).toBe(true);
  });

  it('returns null when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 400 })));
    expect(await fetchHorizon(52.52, 13.4, sunset)).toBeNull();
  });
});

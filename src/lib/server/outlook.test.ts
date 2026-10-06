import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { predictOutlook, upcomingEvents, OUTLOOK_DAYS } from './outlook';
import { nextEvent, predictEvent } from './prediction';

const HOUR = 3600;
const DAY_MS = 24 * 3600 * 1000;

describe('upcomingEvents()', () => {
  it('lists the next week of sunsets, one per day, starting with the next one', () => {
    const now = new Date('2026-10-16T10:00:00Z');
    const events = upcomingEvents(now, 52.52, 13.41, 'sunset');
    expect(events).toHaveLength(OUTLOOK_DAYS);
    expect(events[0]).toEqual(nextEvent(now, 52.52, 13.41, 'sunset').time);
    for (let i = 1; i < events.length; i++) {
      const gap = events[i].getTime() - events[i - 1].getTime();
      // Sunsets get ~3 minutes earlier each day in October.
      expect(gap).toBeGreaterThan(DAY_MS - 10 * 60 * 1000);
      expect(gap).toBeLessThan(DAY_MS);
    }
  });

  it("starts tomorrow once today's event is over", () => {
    const evening = new Date('2026-10-16T18:00:00Z'); // Berlin sunset was ~16:10 UTC
    const [first] = upcomingEvents(evening, 52.52, 13.41, 'sunset');
    expect(first.toISOString().slice(0, 10)).toBe('2026-10-17');
  });

  it('skips days without the event (polar night)', () => {
    // Tromsø: the sun sets for the last time around 26 November.
    const events = upcomingEvents(new Date('2026-11-23T08:00:00Z'), 69.65, 18.96, 'sunset');
    expect(events.length).toBeLessThan(OUTLOOK_DAYS);
    expect(events.every((t) => t.getTime() < Date.UTC(2026, 10, 28))).toBe(true);
  });
});

describe('predictOutlook()', () => {
  // Fake Open-Meteo: 9 days of hourly data from 2026-10-16 00:00 UTC. Clear low
  // sky with a high-cloud canvas, except heavy rain on 19 October.
  const start = Date.UTC(2026, 9, 16) / 1000;
  const hours = Array.from({ length: 9 * 24 }, (_, i) => start + i * HOUR);
  const rainy = (t: number) => t >= Date.UTC(2026, 9, 19) / 1000 && t < Date.UTC(2026, 9, 20) / 1000;
  const forecast = {
    utc_offset_seconds: 7200,
    hourly: {
      time: hours,
      relativehumidity_2m: hours.map((t) => (rainy(t) ? 95 : 55)),
      temperature_2m: hours.map(() => 12),
      cloudcover_low: hours.map((t) => (rainy(t) ? 100 : 5)),
      cloudcover_mid: hours.map((t) => (rainy(t) ? 100 : 20)),
      cloudcover_high: hours.map(() => 50),
      cloudcover: hours.map((t) => (rainy(t) ? 100 : 55)),
      precipitation_probability: hours.map((t) => (rainy(t) ? 95 : 0)),
      precipitation: hours.map((t) => (rainy(t) ? 3 : 0)),
      pressure_msl: hours.map(() => 1015),
      windspeed_10m: hours.map(() => 3),
      visibility: hours.map((t) => (rainy(t) ? 2000 : 30000)),
    },
    daily: { time: [start], sunrise: [start + 5 * HOUR], sunset: [start + 16 * HOUR] },
  };
  // Air quality only covers the first 5 days, like the real API.
  const airQuality = {
    hourly: {
      time: hours.slice(0, 7 * 24),
      aerosol_optical_depth: hours.slice(0, 7 * 24).map((t) => (t < start + 5 * 24 * HOUR ? 0.2 : null)),
      pm2_5: hours.slice(0, 7 * 24).map(() => 8),
    },
  };

  let forecastDown = false;
  const fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.hostname.startsWith('air-quality')) return new Response(JSON.stringify(airQuality));
    const points = url.searchParams.get('latitude')!.split(',');
    if (points.length === 1) return forecastDown ? new Response('down', { status: 500 }) : new Response(JSON.stringify(forecast));
    // Horizon: clear toward the sun, except on the rainy day.
    const location = { hourly: { time: hours, cloudcover_low: hours.map((t) => (rainy(t) ? 100 : 0)), cloudcover_mid: hours.map(() => 0) } };
    return new Response(JSON.stringify(points.map(() => location)));
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T10:00:00Z'));
    fetchMock.mockClear();
    forecastDown = false;
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('scores a week of sunsets from three requests', async () => {
    const outlook = await predictOutlook({ latitude: 52.52, longitude: 13.41, event: 'sunset' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(outlook.timeZone).toBe('Europe/Berlin');
    expect(outlook.days.map((d) => d.date)).toEqual([
      '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22',
    ]);
    const byDate = Object.fromEntries(outlook.days.map((d) => [d.date, d.qualityScore]));
    expect(byDate['2026-10-19']).toBeLessThan(byDate['2026-10-18'] - 20);
  });

  it("scores the first day exactly like the single prediction", async () => {
    const outlook = await predictOutlook({ latitude: 48.14, longitude: 11.58, event: 'sunset' });
    const single = await predictEvent({ latitude: 48.14, longitude: 11.58, event: 'sunset' });
    expect(outlook.days[0]).toMatchObject({
      eventEpochSec: single.timings.eventEpochSec,
      qualityScore: single.qualityScore,
      confidence: single.confidence,
    });
  });

  it('trusts later days less', async () => {
    const { days } = await predictOutlook({ latitude: 50.94, longitude: 6.96, event: 'sunset' });
    expect(days[6].confidence).toBeLessThan(days[0].confidence);
  });

  it('covers the switch to winter time in the dates', async () => {
    vi.setSystemTime(new Date('2026-10-23T10:00:00Z'));
    // Only the dates matter here; the fake forecast ends on the 24th, so scores are rough.
    const { days } = await predictOutlook({ latitude: 52.52, longitude: 13.41, event: 'sunrise' });
    expect(days.map((d) => d.date)).toContain('2026-10-25');
    expect(new Set(days.map((d) => d.date)).size).toBe(days.length);
  });

  it('fails like the single prediction when the forecast is unavailable', async () => {
    forecastDown = true; // also on the retry
    await expect(predictOutlook({ latitude: 40.42, longitude: -3.7, event: 'sunset' })).rejects.toThrow('Failed to fetch weather data');
  });
});

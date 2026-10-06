import SunCalc from 'suncalc';
import { nextEvent, PredictionError, roundCoord, scoreEvent } from '#lib/server/prediction.js';
import { fetchAirQuality, fetchForecast } from '#lib/server/weather.js';
import { fetchHorizons } from '#lib/server/horizon.js';
import { timeZoneAt } from '#lib/server/flight-time.js';
import { BoundedCache } from '#lib/server/bounded-cache.js';
import type { SkyEvent } from '#lib/types.js';

/** How many upcoming sunrises or sunsets the outlook covers. */
export const OUTLOOK_DAYS = 7;

const DAY_MS = 24 * 3600 * 1000;

export type OutlookDay = {
  /** Local date of the event at the location (YYYY-MM-DD). */
  date: string;
  /** UTC epoch seconds of the sunrise or sunset. */
  eventEpochSec: number;
  qualityScore: number;
  confidence: number;
};

export type Outlook = {
  event: SkyEvent;
  /** IANA zone of the location, so the client can show local dates and times (DST included). */
  timeZone: string;
  days: OutlookDay[];
};

/**
 * The next `count` sunrises or sunsets, starting with the one the single
 * prediction would show. Days without the event (polar day/night) are skipped.
 */
export function upcomingEvents(now: Date, latitude: number, longitude: number, event: SkyEvent, count = OUTLOOK_DAYS): Date[] {
  const first = nextEvent(now, latitude, longitude, event).time;
  const start = first ?? now;
  const events: Date[] = [];
  for (let k = 0; events.length < count && k < count + 3; k++) {
    // SunCalc returns the event of the solar day nearest the given time.
    const time = k === 0 && first ? first : SunCalc.getTimes(new Date(start.getTime() + k * DAY_MS), latitude, longitude)[event];
    if (!(time instanceof Date) || isNaN(time.getTime()) || time.getTime() <= now.getTime() - 30 * 60 * 1000) continue;
    const last = events[events.length - 1];
    if (!last || time.getTime() - last.getTime() > DAY_MS / 2) events.push(time);
  }
  return events;
}

const cache = new BoundedCache<Outlook>(30 * 60 * 1000, 300);

/**
 * Scores for the next week of sunrises or sunsets, from three weather requests
 * in total (forecast, air quality, horizon) scored exactly like the single
 * prediction. Days beyond the ~5-day air-quality forecast score without the
 * small aerosol term; lead time lowers confidence as usual.
 */
export async function predictOutlook({
  latitude: rawLatitude,
  longitude: rawLongitude,
  event,
}: {
  latitude: number;
  longitude: number;
  event: SkyEvent;
}): Promise<Outlook> {
  const latitude = roundCoord(rawLatitude);
  const longitude = roundCoord(rawLongitude);
  const now = new Date();
  const times = upcomingEvents(now, latitude, longitude, event);
  const timeZone = timeZoneAt(latitude, longitude);

  const cacheKey = `${latitude},${longitude},${event},${times[0] ? Math.floor(times[0].getTime() / 3600_000) : 'none'}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  if (times.length === 0) return { event, timeZone, days: [] };
  const daysAhead = Math.min(16, Math.ceil((times[times.length - 1].getTime() - now.getTime()) / DAY_MS) + 2);
  const [forecast, airQuality, horizons] = await Promise.all([
    fetchForecast(latitude, longitude, daysAhead),
    fetchAirQuality(latitude, longitude, daysAhead),
    fetchHorizons(latitude, longitude, times),
  ]);
  if (!forecast) throw new PredictionError('Failed to fetch weather data', 502);

  const dateOf = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const days = times.map((time, i) => {
    const eventSec = Math.floor(time.getTime() / 1000);
    const scored = scoreEvent(
      { forecast, airQuality, horizon: horizons[i] },
      { latitude, longitude, event, day: 'today', targetSec: eventSec, eventSec, goldenHourSec: null },
      now.getTime()
    );
    return { date: dateOf.format(time), eventEpochSec: eventSec, qualityScore: scored.qualityScore, confidence: scored.confidence };
  });

  const outlook = { event, timeZone, days };
  cache.set(cacheKey, outlook);
  return outlook;
}

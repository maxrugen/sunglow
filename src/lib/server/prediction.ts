import SunCalc from 'suncalc';
import { evaluate, type WeatherData } from '$lib/server/scoring';
import { airQualityAt, compositeAt, fetchAirQuality, fetchForecast, hourCount, nearestIndex } from '$lib/server/weather';
import { fetchHorizon } from '$lib/server/horizon';
import { timeZoneAt } from '$lib/server/flight-time';
import { BoundedCache } from '$lib/server/bounded-cache';
import type { SkyEvent } from '$lib/types';

export type PredictionPayload = {
  event: SkyEvent;
  qualityScore: number;
  weatherData: WeatherData & {
    pressureMslHpa: number;
    temperature2mC: number;
    dewPointC: number;
    /** Compass bearing toward the sun at the event, when the horizon was sampled. */
    horizonAzimuthDeg?: number;
    selectedHourIndex: number;
    selectedHour: number | undefined;
  };
  confidence: number;
  explanation: { factors: Record<string, unknown> };
  /** Whether the scored event falls on today's or tomorrow's local date. */
  day: 'today' | 'tomorrow';
  /** UTC epoch seconds; null where the event doesn't occur (polar day/night). */
  timings: {
    eventEpochSec: number | null;
    goldenHourEpochSec: number | null;
  };
  used: {
    /** UTC epoch seconds of the scored hour. */
    epochSec: number;
    latitude: number;
    longitude: number;
    utcOffsetSeconds: number;
  };
};

// In-memory cache (ephemeral in serverless environments), keyed by rounded
// coordinates + event + event hour, so repeat lookups skip the upstream fetches.
const responseCache = new BoundedCache<PredictionPayload>(10 * 60 * 1000);

function getCacheKey(lat: number, lon: number, event: SkyEvent, eventEpochSec: number | null): string {
  const bucket =
    eventEpochSec != null
      ? `h:${Math.floor(eventEpochSec / 3600)}`
      : `d:${new Date().toISOString().slice(0, 10)}`;
  return `${lat.toFixed(3)},${lon.toFixed(3)},${event},${bucket}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * How long an event stays "current" after it happens. Sunset color often peaks
 * after the sun is down; sunrise color peaks before the sun is up.
 */
const GRACE_MS: Record<SkyEvent, number> = { sunset: 30 * 60 * 1000, sunrise: 15 * 60 * 1000 };
/** SunCalc golden-hour field: evening golden hour starts, morning golden hour ends. */
const GOLDEN_HOUR_FIELD: Record<SkyEvent, 'goldenHour' | 'goldenHourEnd'> = {
  sunset: 'goldenHour',
  sunrise: 'goldenHourEnd',
};
/** Fallback hour (local) when the sun doesn't rise or set. */
const POLAR_FALLBACK_HOUR: Record<SkyEvent, number> = { sunset: 18, sunrise: 6 };

function validDate(d: unknown): Date | null {
  return d instanceof Date && !isNaN(d.getTime()) ? d : null;
}

function localDateKey(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * The next sunrise or sunset that is still worth predicting.
 *
 * SunCalc returns the event of the solar day nearest the given time, which
 * after local midnight (or at high latitudes) can be one that has already
 * passed. So check yesterday, today and tomorrow and take the earliest event
 * that isn't over yet. `day` compares local calendar dates, so 01:00 gives
 * "this morning's sunrise" rather than "tomorrow's".
 */
export function nextEvent(now: Date, latitude: number, longitude: number, event: SkyEvent) {
  const cutoff = now.getTime() - GRACE_MS[event];
  const next = [-1, 0, 1]
    .map((k) => SunCalc.getTimes(new Date(now.getTime() + k * DAY_MS), latitude, longitude))
    .map((t) => ({ time: validDate(t?.[event]), goldenHour: validDate(t?.[GOLDEN_HOUR_FIELD[event]]) }))
    .filter((c): c is { time: Date; goldenHour: Date | null } => c.time !== null && c.time.getTime() > cutoff)
    .sort((a, b) => a.time.getTime() - b.time.getTime())[0];

  if (!next) return { event, day: 'today' as const, time: null, goldenHour: null };
  const zone = timeZoneAt(latitude, longitude);
  const day = localDateKey(next.time, zone) > localDateKey(now, zone) ? ('tomorrow' as const) : ('today' as const);
  return { event, day, time: next.time, goldenHour: next.goldenHour };
}


/** Carries an HTTP status so the route can translate upstream failures. */
export class PredictionError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'PredictionError';
    this.status = status;
  }
}

/**
 * Fetch weather for a location, select the hour nearest the next sunrise or
 * sunset, and score it. Shared by the /api/predict endpoint, the page's
 * deep-link load and the notification cron.
 */
export async function predictEvent({
  latitude,
  longitude,
  event,
}: {
  latitude: number;
  longitude: number;
  event: SkyEvent;
}): Promise<PredictionPayload> {
  const upcoming = nextEvent(new Date(), latitude, longitude, event);
  const eventSec = upcoming.time ? Math.floor(upcoming.time.getTime() / 1000) : null;

  const cacheKey = getCacheKey(latitude, longitude, event, eventSec);
  const cached = responseCache.get(cacheKey);
  if (cached) return cached;

  const [forecast, aq, horizon] = await Promise.all([
    // Two days so the next event is covered even when today's has passed.
    fetchForecast(latitude, longitude, 2, { daily: 'sunrise,sunset' }),
    fetchAirQuality(latitude, longitude),
    upcoming.time ? fetchHorizon(latitude, longitude, upcoming.time) : Promise.resolve(null),
  ]);
  if (!forecast) {
    throw new PredictionError('Failed to fetch weather data', 502);
  }

  const times = forecast.hourly?.time ?? [];
  const length = hourCount(forecast);
  const utcOffsetSeconds = Number(forecast.utc_offset_seconds ?? 0);

  // Fall back to Open-Meteo's own event time (also a UTC epoch) if SunCalc had none.
  let targetSec = eventSec;
  const apiEvent = Number(forecast.daily?.[event]?.[upcoming.day === 'tomorrow' ? 1 : 0]);
  if (targetSec == null && Number.isFinite(apiEvent)) targetSec = apiEvent;

  let idx = 0;
  if (times.length > 0 && targetSec != null) {
    idx = Math.max(0, nearestIndex(times, targetSec));
  } else if (length > 0) {
    // No event to anchor on (polar day/night): use a typical local hour instead.
    idx = Math.min(POLAR_FALLBACK_HOUR[event], length - 1);
  }

  const c = compositeAt(forecast, idx);
  const selectedEpochSec = Number(times[idx]);
  const airQuality = airQualityAt(aq, selectedEpochSec);
  // PM2.5 only matters to the model when haze is plausible.
  const hazeRelevant = (c.visibilityM && c.visibilityM < 12000) || c.humidity > 75;

  let solarAltitudeDeg: number | undefined;
  try {
    const sunPos = SunCalc.getPosition(new Date(selectedEpochSec * 1000), latitude, longitude);
    const deg = (sunPos.altitude * 180) / Math.PI;
    if (Number.isFinite(deg)) solarAltitudeDeg = deg;
  } catch {}

  const weatherData: PredictionPayload['weatherData'] = {
    highCloud: c.highCloud,
    midCloud: c.midCloud,
    lowCloud: c.lowCloud,
    humidity: c.humidity,
    aod: airQuality.aod ?? 0,
    solarAltitudeDeg,
    totalCloud: c.totalCloud,
    precipitationProbability: c.pop,
    precipitationMmPerHour: c.precipMm,
    pressureMslHpa: c.pressure,
    pressureTrendHpa: c.pressureTrend,
    windSpeed10mMs: c.windMs,
    visibilityM: c.visibilityM,
    temperature2mC: c.tempC,
    dewPointC: c.dewPointC,
    dewPointSpreadC: c.dewSpread,
    pm25UgM3: hazeRelevant ? airQuality.pm25 : undefined,
    horizonCloud: horizon?.blockingPct,
    horizonAzimuthDeg: horizon?.azimuthDeg,
    selectedHourIndex: idx,
    selectedHour: times[idx],
  };
  const alignedToEvent =
    Number.isFinite(selectedEpochSec) && targetSec != null
      ? Math.abs(selectedEpochSec - targetSec) <= 1800 // within 30 minutes of the event
      : false;

  const { score: qualityScore, details, confidence } = evaluate(weatherData, alignedToEvent);

  const payload: PredictionPayload = {
    event,
    qualityScore,
    weatherData,
    confidence,
    explanation: { factors: details },
    day: upcoming.day,
    timings: {
      eventEpochSec: eventSec,
      goldenHourEpochSec: upcoming.goldenHour ? Math.floor(upcoming.goldenHour.getTime() / 1000) : null,
    },
    used: { epochSec: selectedEpochSec, latitude, longitude, utcOffsetSeconds },
  };

  responseCache.set(cacheKey, payload);
  return payload;
}

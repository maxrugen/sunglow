import SunCalc from 'suncalc';
import { evaluate, type WeatherData } from '$lib/server/scoring';
import { airQualityAt, compositeAt, fetchAirQuality, fetchForecast, hourCount, nearestIndex } from '$lib/server/weather';

export type PredictionPayload = {
  qualityScore: number;
  weatherData: WeatherData & {
    pressureMslHpa: number;
    temperature2mC: number;
    dewPointC: number;
    selectedHourIndex: number;
    selectedHour: number | undefined;
  };
  confidence: number;
  explanation: { factors: Record<string, unknown> };
  used: {
    /** UTC epoch seconds of the scored hour. */
    epochSec: number;
    latitude: number;
    longitude: number;
    utcOffsetSeconds: number;
  };
};

// Simple in-memory cache (ephemeral in serverless environments), keyed by
// rounded coordinates + the sunset hour, so repeat lookups skip the upstream fetches.
const responseCache = new Map<string, { ts: number; payload: PredictionPayload }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_MAX_ENTRIES = 500;

function getCacheKey(lat: number, lon: number, sunsetEpochSec: number | null): string {
  const bucket =
    sunsetEpochSec != null
      ? `h:${Math.floor(sunsetEpochSec / 3600)}`
      : `d:${new Date().toISOString().slice(0, 10)}`;
  return `${lat.toFixed(3)},${lon.toFixed(3)},${bucket}`;
}

function cacheSet(key: string, payload: PredictionPayload) {
  if (responseCache.size >= CACHE_MAX_ENTRIES) {
    // Maps iterate in insertion order, so the first key is the oldest.
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) responseCache.delete(oldest);
  }
  responseCache.set(key, { ts: Date.now(), payload });
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
 * Fetch weather for a location, select the hour nearest sunset, and score it.
 * Shared by the /api/predict endpoint, the page's deep-link load and the
 * notification cron.
 */
export async function predictSunset({
  latitude,
  longitude,
}: {
  latitude: number;
  longitude: number;
}): Promise<PredictionPayload> {
  let sunsetSec: number | null = null;
  try {
    const sunset: Date | undefined = SunCalc.getTimes(new Date(), latitude, longitude)?.sunset;
    if (sunset instanceof Date && !isNaN(sunset.getTime())) {
      sunsetSec = Math.floor(sunset.getTime() / 1000);
    }
  } catch {}

  const cacheKey = getCacheKey(latitude, longitude, sunsetSec);
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.payload;
  }

  const [forecast, aq] = await Promise.all([
    fetchForecast(latitude, longitude, 1, { daily: 'sunset' }),
    fetchAirQuality(latitude, longitude),
  ]);
  if (!forecast) {
    throw new PredictionError('Failed to fetch weather data', 502);
  }

  const times = forecast.hourly?.time ?? [];
  const length = hourCount(forecast);
  const utcOffsetSeconds = Number(forecast.utc_offset_seconds ?? 0);

  // Fall back to Open-Meteo's own sunset (also a UTC epoch) if SunCalc had none.
  let targetSec = sunsetSec;
  const apiSunset = Number(forecast.daily?.sunset?.[0]);
  if (targetSec == null && Number.isFinite(apiSunset)) targetSec = apiSunset;

  let idx = 0;
  if (times.length > 0 && targetSec != null) {
    idx = Math.max(0, nearestIndex(times, targetSec));
  } else if (length > 0) {
    // No sunset to anchor on (polar day/night): use 18:00 local as a heuristic.
    idx = Math.min(18, length - 1);
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
    selectedHourIndex: idx,
    selectedHour: times[idx],
  };
  const alignedToSunset =
    Number.isFinite(selectedEpochSec) && targetSec != null
      ? Math.abs(selectedEpochSec - targetSec) <= 1800 // within 30 minutes of sunset
      : false;

  const { score: qualityScore, details, confidence } = evaluate(weatherData, alignedToSunset);

  const payload: PredictionPayload = {
    qualityScore,
    weatherData,
    confidence,
    explanation: { factors: details },
    used: { epochSec: selectedEpochSec, latitude, longitude, utcOffsetSeconds },
  };

  cacheSet(cacheKey, payload);
  return payload;
}

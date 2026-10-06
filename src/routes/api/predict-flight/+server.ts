import { json } from '@sveltejs/kit';
import SunCalc from 'suncalc';
import { evaluateInFlight } from '$lib/server/scoring';
import {
  interpolateGreatCircle,
  findSunsetWindows,
  bestSunsetWaypoint,
  computeSunSide
} from '$lib/server/flight-route';
import { airQualityAt, compositeAt, fetchAirQuality, fetchForecast, nearestIndex } from '$lib/server/weather';
import { resolveFlightTimes, timeZoneAt } from '$lib/server/flight-time';
import { airportByIata } from '$lib/server/airports';
import type { WeatherData } from '$lib/server/scoring';
import type { RequestHandler } from './$types';
import type { FlightPredictionResponse, SunsetWaypoint } from '$lib/types';

// In-memory cache
const cache = new Map<string, { ts: number; payload: FlightPredictionResponse }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Open-Meteo's forecast horizon. */
const MAX_FORECAST_DAYS = 16;
/** Beyond this lead time, forecasts degrade enough to lower confidence. */
const RELIABLE_LEAD_DAYS = 3;

/**
 * Surface weather at a point, for the hour closest to `targetEpochMs`. Returns
 * null when the time is outside the forecast window or the fetch fails.
 */
async function fetchWeatherAtPoint(lat: number, lon: number, targetEpochMs: number): Promise<WeatherData | null> {
  const daysAhead = Math.ceil((targetEpochMs - Date.now()) / DAY_MS);
  if (daysAhead < 0 || daysAhead >= MAX_FORECAST_DAYS) return null;

  const [forecast, aq] = await Promise.all([
    // +1 because the window starts at local midnight today.
    fetchForecast(lat, lon, Math.min(MAX_FORECAST_DAYS, daysAhead + 1)),
    fetchAirQuality(lat, lon)
  ]);
  const times = forecast?.hourly?.time ?? [];
  if (!forecast || times.length === 0) return null;

  const targetSec = Math.floor(targetEpochMs / 1000);
  const idx = nearestIndex(times, targetSec);
  // Nearest hour is far off: the target is outside what was returned.
  if (idx < 0 || Math.abs(times[idx] - targetSec) > 3600) return null;

  const c = compositeAt(forecast, idx);
  const { aod } = airQualityAt(aq, times[idx]);

  let solarAltitudeDeg: number | undefined;
  try {
    const sunPos = SunCalc.getPosition(new Date(targetEpochMs), lat, lon);
    solarAltitudeDeg = (sunPos.altitude * 180) / Math.PI;
  } catch { /* ignore */ }

  return {
    highCloud: c.highCloud,
    midCloud: c.midCloud,
    lowCloud: c.lowCloud,
    humidity: c.humidity,
    aod: aod ?? 0,
    solarAltitudeDeg,
    totalCloud: c.totalCloud,
    precipitationProbability: c.pop,
    precipitationMmPerHour: c.precipMm,
    pressureTrendHpa: c.pressureTrend,
    windSpeed10mMs: c.windMs,
    visibilityM: c.visibilityM,
    dewPointSpreadC: c.dewSpread,
  };
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const depIata = String(body?.depIata ?? '').trim().toUpperCase();
    const arrIata = String(body?.arrIata ?? '').trim().toUpperCase();
    const depTimeStr = String(body?.depTime ?? '');
    const arrTimeStr = String(body?.arrTime ?? '');

    // Validate inputs
    if (!depIata || !arrIata) {
      return json({ error: 'Missing departure or arrival airport.' }, { status: 400 });
    }

    const depAirport = airportByIata(depIata);
    const arrAirport = airportByIata(arrIata);
    if (!depAirport) {
      return json({ error: `Unknown departure airport: ${depIata}` }, { status: 400 });
    }
    if (!arrAirport) {
      return json({ error: `Unknown arrival airport: ${arrIata}` }, { status: 400 });
    }

    // Wall-clock times are local to each airport; see resolveFlightTimes().
    const resolved = resolveFlightTimes(
      depTimeStr,
      arrTimeStr,
      timeZoneAt(depAirport.lat, depAirport.lon),
      timeZoneAt(arrAirport.lat, arrAirport.lon)
    );
    if (!resolved) {
      return json({ error: 'Invalid departure or arrival time.' }, { status: 400 });
    }
    const { depMs: depTimeMs, arrMs: arrTimeMs } = resolved;

    if (arrTimeMs <= depTimeMs) {
      return json({ error: 'Arrival time must be after departure time.' }, { status: 400 });
    }

    const durationMs = arrTimeMs - depTimeMs;
    if (durationMs > 24 * 60 * 60 * 1000) {
      return json({ error: 'Flight duration exceeds 24 hours.' }, { status: 400 });
    }

    // Check cache
    const cacheKey = `${depIata}-${arrIata}-${Math.floor(depTimeMs / 3600000)}-${Math.floor(arrTimeMs / 3600000)}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return json(cached.payload, { headers: { 'Cache-Control': 'public, max-age=120' } });
    }

    // Interpolate route
    const waypoints = interpolateGreatCircle(
      depAirport.lat, depAirport.lon,
      arrAirport.lat, arrAirport.lon,
      depTimeMs, arrTimeMs,
      15 // 15-minute intervals
    );

    // Find sunset windows
    const sunsetWaypoints = findSunsetWindows(waypoints, 60);

    if (sunsetWaypoints.length === 0) {
      const payload: FlightPredictionResponse = {
        sunsetDuringFlight: false,
        message: 'No sunset occurs during this flight. The sun either sets before departure, after arrival, or doesn\'t set at these latitudes on this date.',
        route: {
          departure: { iata: depIata, name: depAirport.name, lat: depAirport.lat, lon: depAirport.lon },
          arrival: { iata: arrIata, name: arrAirport.name, lat: arrAirport.lat, lon: arrAirport.lon },
          departureTime: new Date(depTimeMs).toISOString(),
          arrivalTime: new Date(arrTimeMs).toISOString(),
        }
      };
      cache.set(cacheKey, { ts: Date.now(), payload });
      return json(payload, { headers: { 'Cache-Control': 'public, max-age=120' } });
    }

    // Pick the best sunset waypoint (closest to actual sunset time)
    const best = bestSunsetWaypoint(sunsetWaypoints)!;

    // Fetch weather for the best waypoint
    const weather = await fetchWeatherAtPoint(best.lat, best.lon, best.sunsetTime);

    let qualityScore: number | undefined;
    let confidence: number | undefined;
    let explanation: { factors?: Record<string, unknown> } = {};

    if (weather) {
      const alignedToSunset = best.offsetMinutes <= 30;
      const result = evaluateInFlight(weather, alignedToSunset);
      const leadDays = (best.sunsetTime - Date.now()) / DAY_MS;
      const leadPenalty = Math.min(30, Math.max(0, Math.round((leadDays - RELIABLE_LEAD_DAYS) * 5)));
      qualityScore = result.score;
      confidence = Math.max(0, result.confidence - leadPenalty);
      explanation = { factors: result.details };
    }

    // Compute seat side
    const seatSide = computeSunSide(best.planeHeading, best.sunAzimuth);
    const seatRecommendation = seatSide === 'left'
      ? 'Sit on the left side of the plane for the best sunset view.'
      : 'Sit on the right side of the plane for the best sunset view.';

    // Format sunset time
    const sunsetDate = new Date(best.sunsetTime);
    const sunsetTimeUTC = sunsetDate.toISOString();

    // Sunset location description
    const latDir = best.lat >= 0 ? 'N' : 'S';
    const lonDir = best.lon >= 0 ? 'E' : 'W';
    const sunsetLocation = `${Math.abs(best.lat).toFixed(1)}°${latDir}, ${Math.abs(best.lon).toFixed(1)}°${lonDir}`;

    // Score all sunset waypoints (for advanced display)
    const scoredWaypoints: Array<SunsetWaypoint & { score?: number }> = sunsetWaypoints.map(wp => ({
      ...wp,
      score: wp === best ? qualityScore : undefined // only the best one is scored
    }));

    const payload: FlightPredictionResponse = {
      sunsetDuringFlight: true,
      qualityScore,
      confidence,
      explanation,
      seatSide,
      seatRecommendation,
      sunsetWaypoint: best,
      sunsetTimeUTC,
      sunsetLocation,
      scoredWaypoints,
      route: {
        departure: { iata: depIata, name: depAirport.name, lat: depAirport.lat, lon: depAirport.lon },
        arrival: { iata: arrIata, name: arrAirport.name, lat: arrAirport.lat, lon: arrAirport.lon },
        departureTime: new Date(depTimeMs).toISOString(),
        arrivalTime: new Date(arrTimeMs).toISOString(),
      }
    };

    cache.set(cacheKey, { ts: Date.now(), payload });
    return json(payload, { headers: { 'Cache-Control': 'public, max-age=120' } });
  } catch (err: unknown) {
    console.error('[predict-flight]', err);
    return json({ error: 'Flight prediction failed.' }, { status: 500 });
  }
};

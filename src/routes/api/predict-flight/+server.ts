import { json } from '@sveltejs/kit';
import SunCalc from 'suncalc';
import { evaluateInFlight } from '$lib/server/scoring';
import {
  interpolateGreatCircle,
  findEventWindows,
  bestWaypointPerSighting,
  computeSunSide
} from '$lib/server/flight-route';
import { airQualityAt, compositeAt, fetchAirQuality, fetchForecast, nearestIndex } from '$lib/server/weather';
import { resolveFlightTimes, timeZoneAt } from '$lib/server/flight-time';
import { airportByIata } from '$lib/server/airports';
import { BoundedCache } from '$lib/server/bounded-cache';
import type { WeatherData } from '$lib/server/scoring';
import type { RequestHandler } from './$types';
import type { EventWaypoint, FlightPredictionResponse, FlightSighting } from '$lib/types';

const cache = new BoundedCache<FlightPredictionResponse>(10 * 60 * 1000);

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

/** Score one sighting with the weather at its waypoint and pick the window side. */
async function toSighting(wp: EventWaypoint): Promise<FlightSighting> {
  const weather = await fetchWeatherAtPoint(wp.lat, wp.lon, wp.eventTime);
  let qualityScore: number | undefined;
  let confidence: number | undefined;
  let explanation: FlightSighting['explanation'] = {};
  if (weather) {
    const result = evaluateInFlight(weather, wp.offsetMinutes <= 30);
    const leadDays = (wp.eventTime - Date.now()) / DAY_MS;
    const leadPenalty = Math.min(30, Math.max(0, Math.round((leadDays - RELIABLE_LEAD_DAYS) * 5)));
    qualityScore = result.score;
    confidence = Math.max(0, result.confidence - leadPenalty);
    explanation = { factors: result.details };
  }

  const seatSide = computeSunSide(wp.planeHeading, wp.sunAzimuth);
  const seatRecommendation =
    seatSide === 'either'
      ? `The sun is roughly ${Math.abs(((wp.sunAzimuth - wp.planeHeading + 540) % 360) - 180) < 90 ? 'ahead of' : 'behind'} the plane at ${wp.event}, so either side works.`
      : `Sit on the ${seatSide} side of the plane for the best ${wp.event} view.`;
  const latDir = wp.lat >= 0 ? 'N' : 'S';
  const lonDir = wp.lon >= 0 ? 'E' : 'W';

  return {
    event: wp.event,
    qualityScore,
    confidence,
    explanation,
    seatSide,
    seatRecommendation,
    timeUTC: new Date(wp.eventTime).toISOString(),
    location: `${Math.abs(wp.lat).toFixed(1)}°${latDir}, ${Math.abs(wp.lon).toFixed(1)}°${lonDir}`,
    waypoint: wp,
  };
}

export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  try {
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

    // Exact times: the response echoes them and sightings depend on them, so
    // rounding (e.g. to the hour) would serve another flight's answer.
    const cacheKey = `${depIata}-${arrIata}-${depTimeMs}-${arrTimeMs}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return json(cached, { headers: { 'Cache-Control': 'public, max-age=120' } });
    }

    // Interpolate route
    const waypoints = interpolateGreatCircle(
      depAirport.lat, depAirport.lon,
      arrAirport.lat, arrAirport.lon,
      depTimeMs, arrTimeMs,
      15 // 15-minute intervals
    );

    const route: FlightPredictionResponse['route'] = {
      departure: { iata: depIata, name: depAirport.name, lat: depAirport.lat, lon: depAirport.lon },
      arrival: { iata: arrIata, name: arrAirport.name, lat: arrAirport.lat, lon: arrAirport.lon },
      departureTime: new Date(depTimeMs).toISOString(),
      arrivalTime: new Date(arrTimeMs).toISOString(),
    };

    const best = bestWaypointPerSighting(findEventWindows(waypoints, 60));
    const sightings = await Promise.all(best.map(toSighting));
    const payload: FlightPredictionResponse = sightings.length
      ? { sightings, route }
      : {
          sightings,
          route,
          message:
            "No sunrise or sunset happens during this flight. The sun is either up or down the whole time, or doesn't rise or set at these latitudes on this date.",
        };

    cache.set(cacheKey, payload);
    return json(payload, { headers: { 'Cache-Control': 'public, max-age=120' } });
  } catch (err: unknown) {
    console.error('[predict-flight]', err);
    return json({ error: 'Flight prediction failed.' }, { status: 500 });
  }
};

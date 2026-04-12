import { json } from '@sveltejs/kit';
import SunCalc from 'suncalc';
import { evaluateInFlight } from '$lib/server/scoring';
import {
  interpolateGreatCircle,
  findSunsetWindows,
  bestSunsetWaypoint,
  computeSunSide
} from '$lib/server/flight-route';
import airportsData from '$lib/data/airports.json';
import type { RequestHandler } from './$types';
import type { Airport, FlightPredictionResponse, SunsetWaypoint } from '$lib/types';

const airports: Airport[] = airportsData as Airport[];

// Build a lookup map for fast IATA resolution
const airportByIata = new Map<string, Airport>();
for (const a of airports) {
  airportByIata.set(a.iata, a);
}

// In-memory cache
const cache = new Map<string, { ts: number; payload: FlightPredictionResponse }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

async function fetchWithRetry(url: string, retries = 2, timeoutMs = 8000): Promise<Response> {
  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      if (!res.ok && attempt < retries) {
        attempt++;
        await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt)));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(id);
      if (attempt < retries) {
        attempt++;
        await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt)));
        continue;
      }
      throw e;
    }
  }
}

function computeDewPoint(tempC: number, rh: number): number {
  const a = 17.27;
  const b = 237.7;
  const gamma = (a * tempC) / (b + tempC) + Math.log(Math.max(1e-6, rh) / 100);
  return (b * gamma) / (a - gamma);
}

/**
 * Fetch weather data from Open-Meteo for a specific lat/lon, selecting the
 * hourly index closest to `targetEpochMs`.
 */
async function fetchWeatherAtPoint(lat: number, lon: number, targetEpochMs: number) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: 'relativehumidity_2m,temperature_2m,cloudcover_low,cloudcover_mid,cloudcover_high,cloudcover,precipitation_probability,precipitation,pressure_msl,windspeed_10m,visibility',
    forecast_days: '3',
    timezone: 'auto',
    timeformat: 'unixtime'
  });

  // Try with daily AOD
  let data: any;
  const urlWithDaily = `https://api.open-meteo.com/v1/forecast?${params.toString()}&daily=aerosol_optical_depth`;
  const res = await fetchWithRetry(urlWithDaily, 1, 8000);
  if (res.ok) {
    data = await res.json();
  } else {
    const res2 = await fetchWithRetry(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, 1, 8000);
    if (!res2.ok) return null;
    data = await res2.json();
  }

  const hourly = data?.hourly ?? {};
  const daily = data?.daily ?? {};
  const times: number[] = hourly?.time ?? [];
  const utcOffsetSeconds = Number(data?.utc_offset_seconds ?? 0);

  if (times.length === 0) return null;

  // Find closest hourly index to target time
  const targetSec = Math.floor(targetEpochMs / 1000) + utcOffsetSeconds;
  let idx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const diff = Math.abs(Number(times[i]) - targetSec);
    if (diff < bestDiff) { bestDiff = diff; idx = i; }
  }

  const length = times.length;

  // Weighted composite [idx-1, idx, idx+1] — weights must stay paired with their index
  const indexWeightPairs: Array<[number, number]> = [];
  if (idx - 1 >= 0 && idx - 1 < length) indexWeightPairs.push([idx - 1, 0.3]);
  indexWeightPairs.push([idx, 0.6]);
  if (idx + 1 < length) indexWeightPairs.push([idx + 1, 0.1]);
  const indices = indexWeightPairs.map(([i]) => i);
  const weights = indexWeightPairs.map(([, w]) => w);
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;

  const composite = indices.reduce((acc, i, k) => {
    const w = weights[k] / weightSum;
    acc.humidity += w * Number(hourly?.relativehumidity_2m?.[i] ?? 0);
    acc.tempC += w * Number(hourly?.temperature_2m?.[i] ?? 0);
    acc.lowCloud += w * Number(hourly?.cloudcover_low?.[i] ?? 0);
    acc.midCloud += w * Number(hourly?.cloudcover_mid?.[i] ?? 0);
    acc.highCloud += w * Number(hourly?.cloudcover_high?.[i] ?? 0);
    acc.totalCloud += w * Number(hourly?.cloudcover?.[i] ?? 0);
    acc.pop += w * Number(hourly?.precipitation_probability?.[i] ?? 0);
    acc.precipMm += w * Number(hourly?.precipitation?.[i] ?? 0);
    acc.pressure += w * Number(hourly?.pressure_msl?.[i] ?? 0);
    acc.windMs += w * Number(hourly?.windspeed_10m?.[i] ?? 0);
    acc.visibilityM += w * Number(hourly?.visibility?.[i] ?? 0);
    return acc;
  }, { humidity: 0, tempC: 0, lowCloud: 0, midCloud: 0, highCloud: 0, totalCloud: 0, pop: 0, precipMm: 0, pressure: 0, windMs: 0, visibilityM: 0 });

  let pressureTrend = 0;
  if (idx - 1 >= 0) {
    pressureTrend = composite.pressure - Number(hourly?.pressure_msl?.[idx - 1] ?? composite.pressure);
  }

  const dewpointC = computeDewPoint(composite.tempC, composite.humidity);
  const dewSpread = composite.tempC - dewpointC;

  const aod = Number(daily?.aerosol_optical_depth?.[0] ?? 0);

  // Solar altitude at the target time
  let solarAltitudeDeg: number | undefined;
  try {
    const sunPos = SunCalc.getPosition(new Date(targetEpochMs), lat, lon);
    solarAltitudeDeg = (sunPos.altitude * 180) / Math.PI;
  } catch { /* ignore */ }

  return {
    highCloud: composite.highCloud,
    midCloud: composite.midCloud,
    lowCloud: composite.lowCloud,
    humidity: composite.humidity,
    aod,
    solarAltitudeDeg,
    totalCloud: composite.totalCloud,
    precipitationProbability: composite.pop,
    precipitationMmPerHour: composite.precipMm,
    pressureTrendHpa: pressureTrend,
    windSpeed10mMs: composite.windMs,
    visibilityM: composite.visibilityM,
    dewPointSpreadC: dewSpread,
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

    const depAirport = airportByIata.get(depIata);
    const arrAirport = airportByIata.get(arrIata);
    if (!depAirport) {
      return json({ error: `Unknown departure airport: ${depIata}` }, { status: 400 });
    }
    if (!arrAirport) {
      return json({ error: `Unknown arrival airport: ${arrIata}` }, { status: 400 });
    }

    const depTimeMs = new Date(depTimeStr).getTime();
    const arrTimeMs = new Date(arrTimeStr).getTime();

    if (!Number.isFinite(depTimeMs) || !Number.isFinite(arrTimeMs)) {
      return json({ error: 'Invalid departure or arrival time.' }, { status: 400 });
    }

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
          departureTime: depTimeStr,
          arrivalTime: arrTimeStr,
        }
      };
      cache.set(cacheKey, { ts: Date.now(), payload });
      return json(payload, { headers: { 'Cache-Control': 'public, max-age=120' } });
    }

    // Pick the best sunset waypoint (closest to actual sunset time)
    const best = bestSunsetWaypoint(sunsetWaypoints)!;

    // Fetch weather for the best waypoint
    const weather = await fetchWeatherAtPoint(best.lat, best.lon, best.sunsetTime);

    let qualityScore = 0;
    let confidence = 0;
    let explanation: { factors?: Record<string, unknown> } = {};

    if (weather) {
      const alignedToSunset = best.offsetMinutes <= 30;
      const result = evaluateInFlight(weather, alignedToSunset);
      qualityScore = result.score;
      confidence = result.confidence;
      explanation = { factors: result.details };
    } else {
      qualityScore = 50; // default mid-range if weather unavailable
      confidence = 20;
      explanation = { factors: { note: 'Weather data unavailable for this location/time.' } };
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
    const scoredWaypoints: Array<SunsetWaypoint & { score: number }> = sunsetWaypoints.map(wp => ({
      ...wp,
      score: wp === best ? qualityScore : 0 // only scored the best one
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
        departureTime: depTimeStr,
        arrivalTime: arrTimeStr,
      }
    };

    cache.set(cacheKey, { ts: Date.now(), payload });
    return json(payload, { headers: { 'Cache-Control': 'public, max-age=120' } });
  } catch (err: unknown) {
    console.error('[predict-flight]', err);
    return json({ error: 'Flight prediction failed.' }, { status: 500 });
  }
};

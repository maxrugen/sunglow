import SunCalc from 'suncalc';
import { fetchWithRetry, nearestIndex } from '#lib/server/weather.js';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const EARTH_RADIUS_KM = 6371;

/**
 * Points sampled toward the sun at sunrise or sunset. Light that colors high
 * clouds overhead around the event grazes the surface roughly 100–300 km away
 * in the sun's direction, so those samples count most. The nearest one weighs
 * little because local low cloud is already scored separately.
 */
export const HORIZON_SAMPLES = [
  { km: 50, weight: 0.1 },
  { km: 150, weight: 0.45 },
  { km: 300, weight: 0.45 },
] as const;

/** Mid cloud blocks the grazing light less than low cloud does. */
const MID_CLOUD_FACTOR = 0.5;

export type HorizonSample = { km: number; lat: number; lon: number; lowCloud: number; midCloud: number };

export type Horizon = {
  /** Compass bearing of the sun at the event (0 = north, clockwise). */
  azimuthDeg: number;
  /** Weighted share (0–100) of the path toward the sun blocked by cloud. */
  blockingPct: number;
  samples: HorizonSample[];
};

/** Point reached by travelling `distanceKm` from (lat, lon) along `bearingDeg` on a great circle. */
export function destinationPoint(lat: number, lon: number, bearingDeg: number, distanceKm: number) {
  const δ = distanceKm / EARTH_RADIUS_KM;
  const θ = bearingDeg * DEG_TO_RAD;
  const φ1 = lat * DEG_TO_RAD;
  const λ1 = lon * DEG_TO_RAD;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  // Normalise longitude to [-180, 180) for the antimeridian.
  return { lat: φ2 * RAD_TO_DEG, lon: ((((λ2 * RAD_TO_DEG + 540) % 360) + 360) % 360) - 180 };
}

/** Compass bearing of the sun at `when` (SunCalc measures azimuth from south). */
export function sunAzimuth(when: Date, lat: number, lon: number): number {
  const { azimuth } = SunCalc.getPosition(when, lat, lon);
  return (azimuth * RAD_TO_DEG + 180 + 360) % 360;
}

/** Weighted blocking (0–100) from low cloud plus a share of mid cloud at each sample. */
export function horizonBlocking(samples: Array<Pick<HorizonSample, 'km' | 'lowCloud' | 'midCloud'>>): number {
  let total = 0;
  let weightSum = 0;
  for (const s of samples) {
    const weight = HORIZON_SAMPLES.find((h) => h.km === s.km)?.weight ?? 0;
    total += weight * Math.min(100, s.lowCloud + MID_CLOUD_FACTOR * s.midCloud);
    weightSum += weight;
  }
  return weightSum > 0 ? total / weightSum : 0;
}

type CloudForecast = { hourly?: { time?: number[]; cloudcover_low?: Array<number | null>; cloudcover_mid?: Array<number | null> } };

const DAY_MS = 24 * 3600 * 1000;

/**
 * Cloud cover along the sun's direction at `eventTime` (sunrise or sunset), from a single multi-point
 * Open-Meteo request. Resolves to null on any failure, since the horizon is an
 * optional refinement to the score.
 */
export async function fetchHorizon(lat: number, lon: number, eventTime: Date): Promise<Horizon | null> {
  return (await fetchHorizons(lat, lon, [eventTime]))[0];
}

/**
 * `fetchHorizon()` for several events (e.g. a week of sunsets) in one request.
 * Each event gets its own sample points, since the sun's direction shifts by
 * a few degrees a week. Null entries for events that couldn't be sampled.
 */
export async function fetchHorizons(lat: number, lon: number, eventTimes: Date[]): Promise<Array<Horizon | null>> {
  const none = eventTimes.map(() => null);
  if (eventTimes.length === 0) return none;
  try {
    const perEvent = eventTimes.map((time) => {
      const azimuthDeg = sunAzimuth(time, lat, lon);
      const points = HORIZON_SAMPLES.map((s) => ({ km: s.km, ...destinationPoint(lat, lon, azimuthDeg, s.km) }));
      return { time, azimuthDeg, points };
    });
    const points = perEvent.flatMap((e) => e.points);
    const latestMs = Math.max(...eventTimes.map((t) => t.getTime()));
    // forecast_days counts from today's UTC midnight: one more than the full days until the last event.
    const days = Math.min(16, Math.max(2, Math.ceil((latestMs - Date.now()) / DAY_MS) + 1));
    const params = new URLSearchParams({
      latitude: points.map((p) => p.lat.toFixed(4)).join(','),
      longitude: points.map((p) => p.lon.toFixed(4)).join(','),
      hourly: 'cloudcover_low,cloudcover_mid',
      forecast_days: String(days),
      timeformat: 'unixtime',
    });
    const res = await fetchWithRetry(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {}, 1, 8000);
    if (!res.ok) return none;
    const raw = (await res.json()) as CloudForecast[] | CloudForecast;
    // Open-Meteo answers a single location with an object, several with an array.
    const body = Array.isArray(raw) ? raw : [raw];
    if (body.length !== points.length) return none;

    return perEvent.map(({ time, azimuthDeg, points: eventPoints }, k) => {
      const targetSec = Math.floor(time.getTime() / 1000);
      const samples: HorizonSample[] = [];
      for (let i = 0; i < eventPoints.length; i++) {
        const hourly = body[k * HORIZON_SAMPLES.length + i]?.hourly;
        const idx = nearestIndex(hourly?.time ?? [], targetSec);
        // Open-Meteo marks missing values with null, which Number() would turn into a clear 0 %.
        const low = hourly?.cloudcover_low?.[idx];
        const mid = hourly?.cloudcover_mid?.[idx];
        if (idx < 0 || typeof low !== 'number' || typeof mid !== 'number') return null;
        samples.push({ ...eventPoints[i], lowCloud: low, midCloud: mid });
      }
      return { azimuthDeg, blockingPct: horizonBlocking(samples), samples };
    });
  } catch {
    return none;
  }
}

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

type CloudForecast = { hourly?: { time?: number[]; cloudcover_low?: number[]; cloudcover_mid?: number[] } };

/**
 * Cloud cover along the sun's direction at `eventTime` (sunrise or sunset), from a single multi-point
 * Open-Meteo request. Resolves to null on any failure, since the horizon is an
 * optional refinement to the score.
 */
export async function fetchHorizon(lat: number, lon: number, eventTime: Date): Promise<Horizon | null> {
  try {
    const azimuthDeg = sunAzimuth(eventTime, lat, lon);
    const points = HORIZON_SAMPLES.map((s) => ({ km: s.km, ...destinationPoint(lat, lon, azimuthDeg, s.km) }));
    const params = new URLSearchParams({
      latitude: points.map((p) => p.lat.toFixed(4)).join(','),
      longitude: points.map((p) => p.lon.toFixed(4)).join(','),
      hourly: 'cloudcover_low,cloudcover_mid',
      forecast_days: '2',
      timeformat: 'unixtime',
    });
    const res = await fetchWithRetry(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {}, 1, 8000);
    if (!res.ok) return null;
    const body = (await res.json()) as CloudForecast[];
    if (!Array.isArray(body) || body.length !== points.length) return null;

    const targetSec = Math.floor(eventTime.getTime() / 1000);
    const samples: HorizonSample[] = [];
    for (let i = 0; i < points.length; i++) {
      const hourly = body[i]?.hourly;
      const idx = nearestIndex(hourly?.time ?? [], targetSec);
      const low = Number(hourly?.cloudcover_low?.[idx]);
      const mid = Number(hourly?.cloudcover_mid?.[idx]);
      if (idx < 0 || !Number.isFinite(low) || !Number.isFinite(mid)) return null;
      samples.push({ ...points[i], lowCloud: low, midCloud: mid });
    }
    return { azimuthDeg, blockingPct: horizonBlocking(samples), samples };
  } catch {
    return null;
  }
}

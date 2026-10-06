/**
 * Open-Meteo access shared by the location and flight predictions.
 *
 * All requests use `timeformat=unixtime`; those timestamps are UTC epoch
 * seconds regardless of the `timezone` parameter.
 */

const HOURLY_VARS = [
  'relativehumidity_2m',
  'temperature_2m',
  'cloudcover_low',
  'cloudcover_mid',
  'cloudcover_high',
  'cloudcover',
  'precipitation_probability',
  'precipitation',
  'pressure_msl',
  'windspeed_10m',
  'visibility',
] as const;

type HourlyVar = (typeof HOURLY_VARS)[number];

export type Forecast = {
  utc_offset_seconds?: number;
  hourly?: Partial<Record<HourlyVar | 'time', number[]>>;
  daily?: { sunrise?: number[]; sunset?: number[] };
};

export type AirQuality = {
  hourly?: { time?: number[]; aerosol_optical_depth?: Array<number | null>; pm2_5?: Array<number | null> };
};

export type SurfaceComposite = {
  humidity: number;
  tempC: number;
  lowCloud: number;
  midCloud: number;
  highCloud: number;
  totalCloud: number;
  pop: number;
  precipMm: number;
  pressure: number;
  windMs: number;
  visibilityM: number;
  /** hPa change versus the previous hour. */
  pressureTrend: number;
  dewPointC: number;
  dewSpread: number;
};

export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = 3,
  timeoutMs = 6000,
  backoffBaseMs = 300
): Promise<Response> {
  let attempt = 0;
  const backoff = () => {
    attempt++;
    const delay = Math.min(2000, backoffBaseMs * Math.pow(2, attempt)) + Math.random() * 100;
    return new Promise((r) => setTimeout(r, delay));
  };
  while (true) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      // Client errors (except rate limiting) won't succeed on retry.
      const retryable = res.status >= 500 || res.status === 429;
      if (!res.ok && retryable && attempt < retries) {
        await backoff();
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(id);
      if (attempt < retries) {
        await backoff();
        continue;
      }
      throw e;
    }
  }
}

/** Index of the entry in `epochs` closest to `targetSec`, or -1 if none is finite. */
export function nearestIndex(epochs: ArrayLike<unknown>, targetSec: number): number {
  let bestI = -1;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 0; i < epochs.length; i++) {
    const e = Number(epochs[i]);
    if (!Number.isFinite(e)) continue;
    const diff = Math.abs(e - targetSec);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestI = i;
    }
  }
  return bestI;
}

/** Hourly surface forecast; null if the request fails for any reason. */
export async function fetchForecast(
  latitude: number,
  longitude: number,
  forecastDays: number,
  extra: Record<string, string> = {}
): Promise<Forecast | null> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: HOURLY_VARS.join(','),
    forecast_days: String(forecastDays),
    timezone: 'auto',
    timeformat: 'unixtime',
    ...extra,
  });
  try {
    const res = await fetchWithRetry(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {}, 1, 8000);
    return res.ok ? ((await res.json()) as Forecast) : null;
  } catch {
    // Network errors and timeouts: callers already treat null as "no forecast".
    return null;
  }
}

/**
 * Hourly aerosol optical depth and PM2.5 from the Open-Meteo air-quality API.
 * The forecast API has no AOD variable, so this is the only source for it.
 * Resolves to null on any failure, since both values are optional for scoring.
 */
export async function fetchAirQuality(latitude: number, longitude: number, forecastDays = 5): Promise<AirQuality | null> {
  try {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      hourly: 'aerosol_optical_depth,pm2_5',
      // The air-quality API forecasts at most 7 days.
      forecast_days: String(Math.min(7, forecastDays)),
      timeformat: 'unixtime',
    });
    const res = await fetchWithRetry(`https://air-quality-api.open-meteo.com/v1/air-quality?${params.toString()}`, {}, 1, 6000);
    return res.ok ? ((await res.json()) as AirQuality) : null;
  } catch {
    return null;
  }
}

/** Air quality further than this from the wanted hour (e.g. beyond the forecast range) is ignored. */
const AQ_MAX_GAP_SEC = 2 * 3600;

/** AOD and PM2.5 at the hour nearest `targetSec` (UTC epoch seconds), if the data covers it. */
export function airQualityAt(
  aq: AirQuality | null,
  targetSec: number
): { aod: number | undefined; pm25: number | undefined } {
  const times = aq?.hourly?.time ?? [];
  const i = nearestIndex(times, targetSec);
  if (i < 0 || Math.abs(Number(times[i]) - targetSec) > AQ_MAX_GAP_SEC) return { aod: undefined, pm25: undefined };
  // Missing hours come as null (AOD ends ~5 days out); Number(null) would make them 0.
  const value = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return { aod: value(aq?.hourly?.aerosol_optical_depth?.[i]), pm25: value(aq?.hourly?.pm2_5?.[i]) };
}

/** Number of hours for which every hourly variable has a value slot. */
export function hourCount(forecast: Forecast): number {
  const hourly = forecast.hourly ?? {};
  return Math.min(...HOURLY_VARS.map((v) => hourly[v]?.length ?? 0));
}

/** Dew point from temperature and relative humidity (Magnus formula). */
export function dewPoint(tempC: number, rh: number): number {
  const a = 17.27;
  const b = 237.7;
  const gamma = (a * tempC) / (b + tempC) + Math.log(Math.max(1e-6, rh) / 100);
  return (b * gamma) / (a - gamma);
}

/**
 * Surface conditions around hour `idx`, weighted [idx-1, idx, idx+1] by
 * [0.3, 0.6, 0.1] so the hour leading into sunset counts more than the one after.
 */
export function compositeAt(forecast: Forecast, idx: number): SurfaceComposite {
  const hourly = forecast.hourly ?? {};
  const length = hourCount(forecast);
  const pairs = ([[idx - 1, 0.3], [idx, 0.6], [idx + 1, 0.1]] as const).filter(([i]) => i >= 0 && i < length);
  const weightSum = pairs.reduce((sum, [, w]) => sum + w, 0) || 1;
  const avg = (v: HourlyVar) =>
    pairs.reduce((acc, [i, w]) => acc + (w / weightSum) * Number(hourly[v]?.[i] ?? 0), 0);

  const tempC = avg('temperature_2m');
  const humidity = avg('relativehumidity_2m');
  const pressure = avg('pressure_msl');
  const dewPointC = dewPoint(tempC, humidity);

  return {
    humidity,
    tempC,
    lowCloud: avg('cloudcover_low'),
    midCloud: avg('cloudcover_mid'),
    highCloud: avg('cloudcover_high'),
    totalCloud: avg('cloudcover'),
    pop: avg('precipitation_probability'),
    precipMm: avg('precipitation'),
    pressure,
    windMs: avg('windspeed_10m'),
    visibilityM: avg('visibility'),
    pressureTrend: idx - 1 >= 0 ? pressure - Number(hourly.pressure_msl?.[idx - 1] ?? pressure) : 0,
    dewPointC,
    dewSpread: tempC - dewPointC,
  };
}

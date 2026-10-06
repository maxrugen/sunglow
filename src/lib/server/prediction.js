import SunCalc from 'suncalc';
import { evaluate } from '$lib/server/scoring';

// Simple in-memory cache (ephemeral in serverless environments), keyed by
// rounded coordinates + the sunset hour, so repeat lookups skip the upstream fetches.
const responseCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_MAX_ENTRIES = 500;

function getCacheKey(lat, lon, sunsetEpochSec) {
    const bucket = Number.isFinite(sunsetEpochSec)
        ? `h:${Math.floor(sunsetEpochSec / 3600)}`
        : `d:${new Date().toISOString().slice(0, 10)}`;
    return `${lat.toFixed(3)},${lon.toFixed(3)},${bucket}`;
}

function cacheSet(key, payload) {
    if (responseCache.size >= CACHE_MAX_ENTRIES) {
        // Maps iterate in insertion order, so the first key is the oldest.
        responseCache.delete(responseCache.keys().next().value);
    }
    responseCache.set(key, { ts: Date.now(), payload });
}

/** Index of the entry in `epochs` closest to `targetSec`, or -1 if none is finite. */
function nearestIndex(epochs, targetSec) {
    let bestI = -1;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (let i = 0; i < epochs.length; i++) {
        const e = Number(epochs[i]);
        if (!Number.isFinite(e)) continue;
        const diff = Math.abs(e - targetSec);
        if (diff < bestDiff) { bestDiff = diff; bestI = i; }
    }
    return bestI;
}

export async function fetchWithRetry(url, options = {}, retries = 3, timeoutMs = 6000, backoffBaseMs = 300) {
    let attempt = 0;
    while (true) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(id);
            // Client errors (except rate limiting) won't succeed on retry.
            const retryable = res.status >= 500 || res.status === 429;
            if (!res.ok && retryable && attempt < retries) {
                attempt++;
                const jitter = Math.random() * 100;
                const delay = Math.min(2000, backoffBaseMs * Math.pow(2, attempt)) + jitter;
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }
            return res;
        } catch (e) {
            clearTimeout(id);
            if (attempt < retries) {
                attempt++;
                const jitter = Math.random() * 100;
                const delay = Math.min(2000, backoffBaseMs * Math.pow(2, attempt)) + jitter;
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }
            throw e;
        }
    }
}

/**
 * Hourly aerosol optical depth and PM2.5 from the Open-Meteo air-quality API.
 * The forecast API has no AOD variable, so this is the only source for it.
 * Resolves to null on any failure, since both values are optional for scoring.
 */
export async function fetchAirQuality(latitude, longitude) {
    try {
        const params = new URLSearchParams({
            latitude: String(latitude),
            longitude: String(longitude),
            hourly: 'aerosol_optical_depth,pm2_5',
            forecast_days: '5',
            timeformat: 'unixtime'
        });
        const res = await fetchWithRetry(`https://air-quality-api.open-meteo.com/v1/air-quality?${params.toString()}`, {}, 1, 6000);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

/** AOD and PM2.5 at the hour nearest `targetSec` (UTC epoch seconds). */
export function airQualityAt(aq, targetSec) {
    const i = nearestIndex(aq?.hourly?.time ?? [], targetSec);
    if (i < 0) return { aod: undefined, pm25: undefined };
    const aod = Number(aq.hourly.aerosol_optical_depth?.[i]);
    const pm25 = Number(aq.hourly.pm2_5?.[i]);
    return {
        aod: Number.isFinite(aod) ? aod : undefined,
        pm25: Number.isFinite(pm25) ? pm25 : undefined
    };
}

/**
 * Thrown when the upstream weather fetch fails. Carries an HTTP status so the
 * route can translate it into the same 502 response the endpoint used to send.
 */
export class PredictionError extends Error {
    constructor(message, status = 502) {
        super(message);
        this.name = 'PredictionError';
        this.status = status;
    }
}

/**
 * Fetch weather for a location, select the hour nearest sunset, and score it.
 * Shared by the /api/predict endpoint and the notification cron.
 *
 * Open-Meteo's `timeformat=unixtime` values are true UTC epochs, so hours are
 * matched against the UTC sunset instant directly.
 *
 * @param {{ latitude: number, longitude: number }} coords
 */
export async function predictSunset({ latitude, longitude }) {
    let sunsetSec = null;
    try {
        const sunTimes = SunCalc.getTimes(new Date(), latitude, longitude);
        if (sunTimes && sunTimes.sunset instanceof Date && !isNaN(sunTimes.sunset.getTime())) {
            sunsetSec = Math.floor(sunTimes.sunset.getTime() / 1000);
        }
    } catch {}

    const cacheKey = getCacheKey(latitude, longitude, sunsetSec);
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
        return cached.payload;
    }

    const params = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        hourly: 'relativehumidity_2m,temperature_2m,cloudcover_low,cloudcover_mid,cloudcover_high,cloudcover,precipitation_probability,precipitation,pressure_msl,windspeed_10m,visibility',
        daily: 'sunset',
        forecast_days: '1',
        timezone: 'auto',
        timeformat: 'unixtime'
    });
    const [res, aq] = await Promise.all([
        fetchWithRetry(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {}, 1, 8000),
        fetchAirQuality(latitude, longitude)
    ]);
    if (!res.ok) {
        throw new PredictionError('Failed to fetch weather data', 502);
    }
    const data = await res.json();

    const hourly = data?.hourly ?? {};
    const length = Math.min(
        hourly?.relativehumidity_2m?.length ?? 0,
        hourly?.temperature_2m?.length ?? 0,
        hourly?.cloudcover_low?.length ?? 0,
        hourly?.cloudcover_mid?.length ?? 0,
        hourly?.cloudcover_high?.length ?? 0,
        hourly?.cloudcover?.length ?? 0,
        hourly?.precipitation_probability?.length ?? 0,
        hourly?.precipitation?.length ?? 0,
        hourly?.pressure_msl?.length ?? 0,
        hourly?.windspeed_10m?.length ?? 0,
        hourly?.visibility?.length ?? 0
    );
    const times = hourly?.time ?? [];
    const utcOffsetSeconds = Number(data?.utc_offset_seconds ?? 0);

    // Fall back to Open-Meteo's own sunset (also a UTC epoch) if SunCalc had none.
    let targetSec = sunsetSec;
    if (targetSec == null && Number.isFinite(Number(data?.daily?.sunset?.[0]))) {
        targetSec = Number(data.daily.sunset[0]);
    }

    let idx = 0;
    if (Array.isArray(times) && times.length > 0 && targetSec != null) {
        idx = Math.max(0, nearestIndex(times, targetSec));
    } else if (length > 0) {
        // No sunset to anchor on (polar day/night): use 18:00 local as a heuristic.
        idx = Math.min(18, length - 1);
    }

    // Weighted weather composites — weights stay paired with their index
    const composite = ((inds) => {
        // inds is built as [idx-1, idx, idx+1].filter(valid), so map weights by position
        const allPairs = [[idx - 1, 0.3], [idx, 0.6], [idx + 1, 0.1]];
        const weights = inds.map(i => { const p = allPairs.find(([ai]) => ai === i); return p ? p[1] : 0; });
        const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
        return inds.reduce((acc, i, k) => {
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
    })([idx - 1, idx, idx + 1].filter((i) => i >= 0 && i < length));

    // Pressure tendency from previous exact hour if available
    let pressureTrend = 0;
    if (idx - 1 >= 0) {
        const pPrev = Number(hourly?.pressure_msl?.[idx - 1] ?? composite.pressure);
        pressureTrend = composite.pressure - pPrev; // hPa
    }

    // Dew point from temperature and humidity (Magnus formula)
    function computeDewPoint(tempC, rh) {
        const a = 17.27;
        const b = 237.7;
        const gamma = (a * tempC) / (b + tempC) + Math.log(Math.max(1e-6, rh) / 100);
        return (b * gamma) / (a - gamma);
    }
    const dewpointC = computeDewPoint(composite.tempC, composite.humidity);
    const dewSpread = composite.tempC - dewpointC;

    const selectedEpochSec = Number(times?.[idx]);
    const airQuality = airQualityAt(aq, selectedEpochSec);
    // PM2.5 only matters to the model when haze is plausible.
    const hazeRelevant = (composite.visibilityM && composite.visibilityM < 12000) || composite.humidity > 75;

    // Solar altitude at selected hour for scoring band weighting
    let solarAltitudeDeg = null;
    try {
        const sunPos = SunCalc.getPosition(new Date(selectedEpochSec * 1000), latitude, longitude);
        solarAltitudeDeg = (sunPos.altitude * 180) / Math.PI;
    } catch {}

    const weatherData = {
        highCloud: composite.highCloud,
        midCloud: composite.midCloud,
        lowCloud: composite.lowCloud,
        humidity: composite.humidity,
        aod: airQuality.aod ?? 0,
        solarAltitudeDeg: Number.isFinite(solarAltitudeDeg) ? solarAltitudeDeg : undefined,
        totalCloud: composite.totalCloud,
        precipitationProbability: composite.pop,
        precipitationMmPerHour: composite.precipMm,
        pressureMslHpa: composite.pressure,
        pressureTrendHpa: pressureTrend,
        windSpeed10mMs: composite.windMs,
        visibilityM: composite.visibilityM,
        temperature2mC: composite.tempC,
        dewPointC: dewpointC,
        dewPointSpreadC: dewSpread,
        pm25UgM3: hazeRelevant ? airQuality.pm25 : undefined,
        selectedHourIndex: idx,
        selectedHour: times?.[idx]
    };
    const alignedToSunset = Number.isFinite(selectedEpochSec) && targetSec != null
        ? Math.abs(selectedEpochSec - targetSec) <= 1800 // within 30 minutes of sunset
        : false;

    const { score: qualityScore, details, confidence } = evaluate(weatherData, alignedToSunset);

    const payload = {
        qualityScore,
        weatherData,
        confidence,
        explanation: { factors: details },
        used: { epochSec: selectedEpochSec, latitude, longitude, utcOffsetSeconds }
    };

    cacheSet(cacheKey, payload);

    return payload;
}

import SunCalc from 'suncalc';
import { evaluate } from '$lib/server/scoring';

// Simple in-memory cache (ephemeral in serverless environments)
// Keyed by lat,lon,yyyy-mm-dd,hour
const responseCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getCacheKey(lat, lon) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const day = `${y}-${m}-${d}`;
    return `${lat.toFixed(3)},${lon.toFixed(3)},${day}`;
}

function getCacheKeyWithHour(lat, lon, epochSecLocal) {
    const dayKey = getCacheKey(lat, lon);
    const hourKey = Number.isFinite(epochSecLocal) ? Math.floor(epochSecLocal / 3600) : 'na';
    return `${dayKey},h:${hourKey}`;
}

export async function fetchWithRetry(url, options = {}, retries = 3, timeoutMs = 6000, backoffBaseMs = 300) {
    let attempt = 0;
    while (true) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(id);
            if (!res.ok && attempt < retries) {
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
 * Returns the same payload shape the /api/predict endpoint has always returned,
 * so it can be reused by both the endpoint and the notification cron.
 *
 * @param {{ latitude: number, longitude: number }} coords
 */
export async function predictSunset({ latitude, longitude }) {
    const baseParams = {
        latitude: String(latitude),
        longitude: String(longitude),
        hourly: 'relativehumidity_2m,temperature_2m,cloudcover_low,cloudcover_mid,cloudcover_high,cloudcover,precipitation_probability,precipitation,pressure_msl,windspeed_10m,visibility',
        forecast_days: '1',
        timezone: 'auto',
        timeformat: 'unixtime'
    };

    // Attempt with daily AOD first (may not be supported in all datasets)
    let data;
    {
        const params = new URLSearchParams({ ...baseParams, daily: 'aerosol_optical_depth,sunset' });
        const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
        const res = await fetchWithRetry(url, {}, 1, 8000);
        if (res.ok) {
            data = await res.json();
        } else {
            // Fallback without daily param
            const paramsNoDaily = new URLSearchParams(baseParams);
            const urlNoDaily = `https://api.open-meteo.com/v1/forecast?${paramsNoDaily.toString()}`;
            const res2 = await fetchWithRetry(urlNoDaily, {}, 1, 8000);
            if (!res2.ok) {
                throw new PredictionError('Failed to fetch weather data', 502);
            }
            data = await res2.json();
        }
    }

    const hourly = data?.hourly ?? {};
    const daily = data?.daily ?? {};
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

    // Select the hourly index nearest to actual sunset (SunCalc), aligned to location timezone
    const times = hourly?.time ?? [];
    const utcOffsetSeconds = Number(data?.utc_offset_seconds ?? 0);

    // With timeformat=unixtime, hourly.time and daily.sunset are epoch seconds (aligned to the provided timezone)

    // Compute sunset using SunCalc (absolute moment), then express it in the location's local timezone
    let sunset = null;
    try {
        const sunTimes = SunCalc.getTimes(new Date(), latitude, longitude);
        if (sunTimes && sunTimes.sunset instanceof Date && !isNaN(sunTimes.sunset.getTime())) {
            sunset = sunTimes.sunset;
        }
    } catch {}

    // Fallback to Open-Meteo daily sunset if available
    let targetEpochLocalSec = null;
    if (!sunset && data?.daily?.sunset?.[0] != null) {
        const s = Number(data.daily.sunset[0]); // seconds since epoch (local clock)
        if (Number.isFinite(s)) targetEpochLocalSec = s;
    }

    let idx = 0;
    if (Array.isArray(times) && times.length > 0) {
        // derive target epoch seconds of local sunset hour
        if (sunset && targetEpochLocalSec == null) {
            targetEpochLocalSec = Math.floor(sunset.getTime() / 1000) + utcOffsetSeconds;
        }

        if (targetEpochLocalSec != null) {
            // choose closest hour by epoch seconds
            let bestI = 0;
            let bestDiff = Number.POSITIVE_INFINITY;
            for (let i = 0; i < times.length; i++) {
                const e = Number(times[i]);
                if (!Number.isFinite(e)) continue;
                const diff = Math.abs(e - targetEpochLocalSec);
                if (diff < bestDiff) { bestDiff = diff; bestI = i; }
            }
            idx = bestI;
        } else {
            // Fallback: pick 18:00 local if we can't compute target, using hour-of-day heuristic
            // With unixtime, we approximate by selecting the 18th element if available
            idx = Math.min(18, times.length - 1);
        }
    } else if (length > 0) {
        idx = Math.min(18, length - 1);
    }

    const aod = Number(daily?.aerosol_optical_depth?.[0] ?? 0);

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

    // Optional: Air quality for PM2.5/PM10 – request only when visibility/humidity suggest haze relevance
    let pm25 = undefined;
    if ((composite.visibilityM && composite.visibilityM < 12000) || composite.humidity > 75) {
        try {
            const aqParams = new URLSearchParams({
                latitude: String(latitude),
                longitude: String(longitude),
                hourly: 'pm2_5',
                timezone: 'auto',
                timeformat: 'unixtime'
            });
            const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?${aqParams.toString()}`;
            const aqRes = await fetchWithRetry(aqUrl, {}, 1, 6000);
            if (aqRes.ok) {
                const aq = await aqRes.json();
                const aqTimes = aq?.hourly?.time || [];
                const targetSec = Number(times?.[idx]);
                if (Number.isFinite(targetSec)) {
                    let bestI = -1;
                    let bestDiff = Number.POSITIVE_INFINITY;
                    for (let i = 0; i < aqTimes.length; i++) {
                        const e = Number(aqTimes[i]);
                        if (!Number.isFinite(e)) continue;
                        const diff = Math.abs(e - targetSec);
                        if (diff < bestDiff) { bestDiff = diff; bestI = i; }
                    }
                    if (bestI >= 0) pm25 = Number(aq?.hourly?.pm2_5?.[bestI]);
                }
            }
        } catch {}
    }

    // Solar altitude at selected hour (approximate) for scoring band weighting
    let solarAltitudeDeg = null;
    try {
        const selectedUtcMs = (Number(times?.[idx]) - utcOffsetSeconds) * 1000; // convert local epoch seconds to UTC ms
        const sunPos = SunCalc.getPosition(new Date(selectedUtcMs), latitude, longitude);
        solarAltitudeDeg = (sunPos.altitude * 180) / Math.PI;
    } catch {}

    const weatherData = {
        highCloud: composite.highCloud,
        midCloud: composite.midCloud,
        lowCloud: composite.lowCloud,
        humidity: composite.humidity,
        aod,
        solarAltitudeDeg: solarAltitudeDeg ?? undefined,
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
        pm25UgM3: pm25,
        selectedHourIndex: idx,
        selectedHour: times?.[idx]
    };
    const selectedEpochSec = Number(times?.[idx]);
    const alignedToSunset = Number.isFinite(selectedEpochSec) && targetEpochLocalSec != null
        ? Math.abs(selectedEpochSec - targetEpochLocalSec) <= 1800 // within 30 minutes of sunset hour
        : false;

    // Serve from the short-lived in-memory cache if we already scored this hour.
    const hourKey = getCacheKeyWithHour(latitude, longitude, selectedEpochSec);
    const cached = responseCache.get(hourKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
        return cached.payload;
    }

    const { score: qualityScore, details, confidence } = evaluate(weatherData, alignedToSunset);

    const payload = {
        qualityScore,
        weatherData,
        confidence,
        explanation: { factors: details },
        used: { epochSecLocal: selectedEpochSec, latitude, longitude }
    };

    try { responseCache.set(hourKey, { ts: Date.now(), payload }); } catch {}

    return payload;
}

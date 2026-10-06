import SunCalc from 'suncalc';
import type { PageServerLoad } from './$types';
import { predictSunset } from '$lib/server/prediction';

/** Server-render a prediction for deep links like /?lat=…&lon=…&label=… (e.g. from push notifications). */
export const load: PageServerLoad = async ({ url }) => {
  const latitude = Number(url.searchParams.get('lat'));
  const longitude = Number(url.searchParams.get('lon'));
  const label = url.searchParams.get('label') || '';

  const valid =
    url.searchParams.has('lat') &&
    url.searchParams.has('lon') &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180;
  if (!valid) return {};

  try {
    const payload = await predictSunset({ latitude, longitude });
    const times = SunCalc.getTimes(new Date(), latitude, longitude);
    return {
      ssr: {
        latitude,
        longitude,
        label,
        qualityScore: payload.qualityScore,
        confidence: payload.confidence,
        explanation: payload.explanation as { factors?: Record<string, unknown> },
        used: payload.used,
        timings: { sunset: times.sunset ?? null, goldenHour: times.goldenHour ?? null },
      },
    };
  } catch {
    // Fall back to the search view; the client can retry from there.
    return {};
  }
};

import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';
import { predictSunset } from '$lib/server/prediction';
import { createRatingToken } from '$lib/server/ratings';

/** Server-render a prediction for deep links like /?lat=…&lon=…&label=… (e.g. from push notifications). */
export const load: PageServerLoad = async ({ url }) => {
  const latitude = Number(url.searchParams.get('lat'));
  const longitude = Number(url.searchParams.get('lon'));
  const label = url.searchParams.get('label') || '';
  // Lets the flight form show the lookup without probing (and spending quota on) the API.
  const flightLookupAvailable = Boolean(env.AVIATIONSTACK_API_KEY);

  const valid =
    url.searchParams.has('lat') &&
    url.searchParams.has('lon') &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180;
  if (!valid) return { flightLookupAvailable };

  try {
    const payload = await predictSunset({ latitude, longitude });
    return {
      flightLookupAvailable,
      ssr: {
        latitude,
        longitude,
        label,
        qualityScore: payload.qualityScore,
        confidence: payload.confidence,
        explanation: payload.explanation,
        day: payload.day,
        timings: payload.timings,
        used: payload.used,
        ratingToken: createRatingToken(payload),
      },
    };
  } catch {
    // Fall back to the search view; the client can retry from there.
    return { flightLookupAvailable };
  }
};

import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';
import { predictEvent } from '$lib/server/prediction';
import { createRatingToken } from '$lib/server/ratings';
import { cleanLabel, parseLatLon } from '$lib/server/validate';
import type { SkyEvent } from '$lib/types';

/**
 * Server-render a prediction for deep links like /?lat=…&lon=…&label=…&event=sunrise
 * (e.g. from push notifications). `event` alone preselects the Sunset/Sunrise switch.
 */
export const load: PageServerLoad = async ({ url }) => {
  const label = cleanLabel(url.searchParams.get('label')) ?? '';
  const eventParam = url.searchParams.get('event');
  const event: SkyEvent | undefined = eventParam === 'sunrise' || eventParam === 'sunset' ? eventParam : undefined;
  // Lets the flight form offer flight-number/route search without probing (and spending quota on) the API.
  const flightLookupAvailable = Boolean(env.AIRLABS_API_KEY);

  const coords = parseLatLon(url.searchParams.get('lat'), url.searchParams.get('lon'));
  if (!coords) return { flightLookupAvailable, event };
  const { latitude, longitude } = coords;

  try {
    const payload = await predictEvent({ latitude, longitude, event: event ?? 'sunset' });
    return {
      flightLookupAvailable,
      event: payload.event,
      ssr: {
        event: payload.event,
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
    return { flightLookupAvailable, event };
  }
};

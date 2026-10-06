import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { predictEvent, PredictionError } from '$lib/server/prediction';
import { createRatingToken } from '$lib/server/ratings';

export const POST: RequestHandler = async ({ request }) => {
  let body: { latitude?: unknown; longitude?: unknown; event?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const latitude = Number(body?.latitude);
  const longitude = Number(body?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return json({ error: 'Invalid or missing latitude/longitude' }, { status: 400 });
  }

  const event = body?.event ?? 'sunset';
  if (event !== 'sunset' && event !== 'sunrise') {
    return json({ error: "event must be 'sunset' or 'sunrise'" }, { status: 400 });
  }

  try {
    const payload = await predictEvent({ latitude, longitude, event });
    // Short-lived caching by proxies/clients; the server also caches per sunset hour.
    return json(
      { ...payload, ratingToken: createRatingToken(payload) },
      { headers: { 'Cache-Control': 'public, max-age=120' } }
    );
  } catch (err) {
    if (err instanceof PredictionError) {
      return json({ error: err.message }, { status: err.status });
    }
    console.error('[predict]', err);
    return json({ error: 'Prediction failed' }, { status: 500 });
  }
};

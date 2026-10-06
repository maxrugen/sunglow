import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { sunsetRatings } from '$lib/server/db/schema';
import { inRatingWindow, ratingsConfigured, verifyRatingToken } from '$lib/server/ratings';

const DEVICE_ID = /^[A-Za-z0-9-]{8,64}$/;

/** POST { token, rating: 1–5, deviceId } — records how a predicted sunrise or sunset actually looked. */
export const POST: RequestHandler = async ({ request }) => {
  if (!ratingsConfigured()) {
    return json({ error: 'Ratings are not enabled.' }, { status: 501 });
  }

  let body: { token?: unknown; rating?: unknown; deviceId?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rating = Number(body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return json({ error: 'Rating must be a whole number from 1 to 5.' }, { status: 400 });
  }
  if (typeof body?.deviceId !== 'string' || !DEVICE_ID.test(body.deviceId)) {
    return json({ error: 'Invalid device id.' }, { status: 400 });
  }
  const snapshot = typeof body?.token === 'string' ? verifyRatingToken(body.token) : null;
  if (!snapshot) {
    return json({ error: 'Invalid rating token.' }, { status: 400 });
  }
  if (!inRatingWindow(snapshot.eventEpochSec)) {
    return json({ error: `This ${snapshot.event} can no longer be rated.` }, { status: 410 });
  }

  const values = {
    event: snapshot.event,
    deviceId: body.deviceId,
    latitude: snapshot.latitude,
    longitude: snapshot.longitude,
    sunsetAt: new Date(snapshot.eventEpochSec * 1000),
    rating,
    predictedScore: snapshot.predictedScore,
    confidence: snapshot.confidence,
    scoringVersion: snapshot.scoringVersion,
    weather: snapshot.weather,
  };
  await db
    .insert(sunsetRatings)
    .values(values)
    // Re-rating the same sunset from the same device replaces the earlier answer.
    .onConflictDoUpdate({
      target: [sunsetRatings.deviceId, sunsetRatings.sunsetAt, sunsetRatings.latitude, sunsetRatings.longitude],
      set: { rating, createdAt: new Date() },
    });

  return json({ ok: true });
};

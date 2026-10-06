import { createHmac, timingSafeEqual } from 'node:crypto';
import * as env from '$app/env/private';
import { SCORING_VERSION, type WeatherData } from '#lib/server/scoring.js';
import type { SkyEvent } from '#lib/types.js';
import type { PendingRating } from '#lib/rating-store.js';

/** Ratings are accepted from the event until this long after it. */
export const RATING_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Allow rating slightly before the official sunrise/sunset (clock skew, early color). */
const EARLY_GRACE_MS = 15 * 60 * 1000;

export type RatingSnapshot = {
  event: SkyEvent;
  latitude: number;
  longitude: number;
  /** UTC epoch seconds of the sunrise or sunset. */
  eventEpochSec: number;
  predictedScore: number;
  confidence: number;
  scoringVersion: number;
  weather: WeatherData;
};

/** Ratings need a signing secret and a database; otherwise the feature is off. */
export function ratingsConfigured(): boolean {
  return Boolean(env.RATING_SECRET && env.DATABASE_URL);
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

/**
 * Signed snapshot of a prediction. The client hands it back with a rating, so
 * the server can store what the model actually saw without logging every
 * prediction, and clients can't submit made-up inputs.
 */
export function createRatingToken(prediction: {
  event: SkyEvent;
  qualityScore: number;
  confidence: number;
  weatherData: WeatherData;
  used: { latitude: number; longitude: number };
  timings: { eventEpochSec: number | null };
}): string | undefined {
  const secret = env.RATING_SECRET;
  if (!secret || !env.DATABASE_URL || prediction.timings.eventEpochSec == null) return undefined;
  const snapshot: RatingSnapshot = {
    event: prediction.event,
    latitude: Math.round(prediction.used.latitude * 100) / 100,
    longitude: Math.round(prediction.used.longitude * 100) / 100,
    eventEpochSec: prediction.timings.eventEpochSec,
    predictedScore: prediction.qualityScore,
    confidence: prediction.confidence,
    scoringVersion: SCORING_VERSION,
    weather: prediction.weatherData,
  };
  const body = Buffer.from(JSON.stringify(snapshot)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

/** Snapshot from a token, or null if it is malformed or the signature doesn't match. */
export function verifyRatingToken(token: string): RatingSnapshot | null {
  const secret = env.RATING_SECRET;
  if (!secret) return null;
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const raw = JSON.parse(Buffer.from(body, 'base64url').toString());
    // Tokens issued before sunrise mode had no event and named the time sunsetEpochSec.
    const { sunsetEpochSec, ...rest } = raw;
    return { ...rest, event: raw.event ?? 'sunset', eventEpochSec: raw.eventEpochSec ?? sunsetEpochSec } as RatingSnapshot;
  } catch {
    return null;
  }
}

/**
 * A rating request from a follow-up notification link (`/?rate=<token>`), or
 * null if the token is invalid or its sunrise/sunset can no longer be rated.
 */
export function ratingRequestFrom(token: string, label: string, nowMs = Date.now()): PendingRating | null {
  const snapshot = verifyRatingToken(token);
  if (!snapshot || !inRatingWindow(snapshot.eventEpochSec, nowMs)) return null;
  return {
    token,
    label: label || 'your location',
    event: snapshot.event,
    eventEpochSec: snapshot.eventEpochSec,
    predictedScore: snapshot.predictedScore,
  };
}

/** Whether `nowMs` falls in the window in which a sunrise or sunset can be rated. */
export function inRatingWindow(eventEpochSec: number, nowMs = Date.now()): boolean {
  const eventMs = eventEpochSec * 1000;
  return nowMs >= eventMs - EARLY_GRACE_MS && nowMs <= eventMs + RATING_WINDOW_MS;
}

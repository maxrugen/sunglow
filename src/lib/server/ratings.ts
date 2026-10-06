import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { SCORING_VERSION, type WeatherData } from '$lib/server/scoring';

/** Ratings are accepted from sunset until this long after it. */
export const RATING_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Allow rating slightly before the official sunset (clock skew, early color). */
const EARLY_GRACE_MS = 15 * 60 * 1000;

export type RatingSnapshot = {
  latitude: number;
  longitude: number;
  sunsetEpochSec: number;
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
  qualityScore: number;
  confidence: number;
  weatherData: WeatherData;
  used: { latitude: number; longitude: number };
  timings: { sunsetEpochSec: number | null };
}): string | undefined {
  const secret = env.RATING_SECRET;
  if (!secret || !env.DATABASE_URL || prediction.timings.sunsetEpochSec == null) return undefined;
  const snapshot: RatingSnapshot = {
    latitude: Math.round(prediction.used.latitude * 100) / 100,
    longitude: Math.round(prediction.used.longitude * 100) / 100,
    sunsetEpochSec: prediction.timings.sunsetEpochSec,
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
    return JSON.parse(Buffer.from(body, 'base64url').toString()) as RatingSnapshot;
  } catch {
    return null;
  }
}

/** Whether `nowMs` falls in the window in which a sunset can be rated. */
export function inRatingWindow(sunsetEpochSec: number, nowMs = Date.now()): boolean {
  const sunsetMs = sunsetEpochSec * 1000;
  return nowMs >= sunsetMs - EARLY_GRACE_MS && nowMs <= sunsetMs + RATING_WINDOW_MS;
}

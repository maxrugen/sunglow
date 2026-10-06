import { describe, it, expect, vi, beforeEach } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const { createRatingToken, verifyRatingToken, inRatingWindow, ratingsConfigured } = await import('./ratings');
const { SCORING_VERSION } = await import('./scoring');

const prediction = {
  event: 'sunset' as const,
  qualityScore: 82,
  confidence: 90,
  weatherData: { highCloud: 50, midCloud: 30, lowCloud: 5, humidity: 50, aod: 0.2 },
  used: { latitude: 52.52437, longitude: 13.41053 },
  timings: { eventEpochSec: 1_790_000_000 },
};

beforeEach(() => {
  env.RATING_SECRET = 'test-secret';
  env.DATABASE_URL = 'postgres://example';
});

describe('rating tokens', () => {
  it('round-trips a snapshot with rounded coordinates and the scoring version', () => {
    const snapshot = verifyRatingToken(createRatingToken(prediction)!);
    expect(snapshot).toEqual({
      event: 'sunset',
      latitude: 52.52,
      longitude: 13.41,
      eventEpochSec: 1_790_000_000,
      predictedScore: 82,
      confidence: 90,
      scoringVersion: SCORING_VERSION,
      weather: prediction.weatherData,
    });
  });

  it('rejects tampered or foreign tokens', () => {
    const token = createRatingToken(prediction)!;
    const [body, sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), predictedScore: 5 })
    ).toString('base64url');
    expect(verifyRatingToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyRatingToken(`${body}.${sig}x`)).toBeNull();
    expect(verifyRatingToken('garbage')).toBeNull();

    env.RATING_SECRET = 'other-secret';
    expect(verifyRatingToken(token)).toBeNull();
  });

  it('is off without a secret or database', () => {
    env.RATING_SECRET = undefined;
    expect(ratingsConfigured()).toBe(false);
    expect(createRatingToken(prediction)).toBeUndefined();

    env.RATING_SECRET = 'test-secret';
    env.DATABASE_URL = undefined;
    expect(createRatingToken(prediction)).toBeUndefined();
  });

  it('skips predictions without a sunset', () => {
    expect(createRatingToken({ ...prediction, timings: { eventEpochSec: null } })).toBeUndefined();
  });

  it('carries the event for sunrise predictions', () => {
    const snapshot = verifyRatingToken(createRatingToken({ ...prediction, event: 'sunrise' })!);
    expect(snapshot?.event).toBe('sunrise');
  });

  it('still reads tokens issued before sunrise mode', async () => {
    const { createHmac } = await import('node:crypto');
    const legacy = { latitude: 52.52, longitude: 13.41, sunsetEpochSec: 1_790_000_000, predictedScore: 82, confidence: 90, scoringVersion: 1, weather: {} };
    const body = Buffer.from(JSON.stringify(legacy)).toString('base64url');
    const sig = createHmac('sha256', 'test-secret').update(body).digest('base64url');
    const snapshot = verifyRatingToken(`${body}.${sig}`);
    expect(snapshot).toMatchObject({ event: 'sunset', eventEpochSec: 1_790_000_000, predictedScore: 82 });
    expect(snapshot).not.toHaveProperty('sunsetEpochSec');
  });
});

describe('inRatingWindow()', () => {
  const sunset = 1_790_000_000;
  it('opens 15 minutes before sunset and closes 24 hours after', () => {
    expect(inRatingWindow(sunset, (sunset - 20 * 60) * 1000)).toBe(false);
    expect(inRatingWindow(sunset, (sunset - 10 * 60) * 1000)).toBe(true);
    expect(inRatingWindow(sunset, (sunset + 23 * 3600) * 1000)).toBe(true);
    expect(inRatingWindow(sunset, (sunset + 25 * 3600) * 1000)).toBe(false);
  });
});

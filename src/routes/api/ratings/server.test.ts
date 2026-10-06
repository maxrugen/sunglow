import { describe, it, expect, vi, beforeEach } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const inserted: unknown[] = [];
vi.mock('$lib/server/db', () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => ({
        onConflictDoUpdate: async () => {
          inserted.push(v);
        },
      }),
    }),
  },
}));

const { POST } = await import('./+server');
const { createRatingToken } = await import('$lib/server/ratings');

const sunsetEpochSec = Math.floor(Date.now() / 1000) - 3600; // an hour ago
const prediction = {
  event: 'sunset' as 'sunset' | 'sunrise',
  qualityScore: 70,
  confidence: 80,
  weatherData: { highCloud: 50, midCloud: 30, lowCloud: 5, humidity: 50, aod: 0.2 },
  used: { latitude: 48.14, longitude: 11.58 },
  timings: { eventEpochSec: sunsetEpochSec },
};

function call(body: unknown) {
  const request = new Request('http://localhost/api/ratings', { method: 'POST', body: JSON.stringify(body) });
  return POST({ request } as Parameters<typeof POST>[0]);
}

beforeEach(() => {
  env.RATING_SECRET = 'test-secret';
  env.DATABASE_URL = 'postgres://example';
  inserted.length = 0;
});

describe('POST /api/ratings', () => {
  it('stores a valid rating with its snapshot', async () => {
    const res = await call({ token: createRatingToken(prediction), rating: 4, deviceId: 'device-1234' });
    expect(res.status).toBe(200);
    expect(inserted).toEqual([
      expect.objectContaining({ event: 'sunset', deviceId: 'device-1234', rating: 4, predictedScore: 70, latitude: 48.14 }),
    ]);
  });

  it('stores sunrise ratings with their event', async () => {
    const res = await call({ token: createRatingToken({ ...prediction, event: 'sunrise' }), rating: 5, deviceId: 'device-1234' });
    expect(res.status).toBe(200);
    expect(inserted).toEqual([expect.objectContaining({ event: 'sunrise', rating: 5 })]);
  });

  it('rejects bad input', async () => {
    const token = createRatingToken(prediction);
    expect((await call({ token, rating: 6, deviceId: 'device-1234' })).status).toBe(400);
    expect((await call({ token, rating: 3, deviceId: 'x' })).status).toBe(400);
    expect((await call({ token: 'forged.token', rating: 3, deviceId: 'device-1234' })).status).toBe(400);
    expect(inserted).toHaveLength(0);
  });

  it('refuses sunsets outside the rating window', async () => {
    const old = createRatingToken({ ...prediction, timings: { eventEpochSec: sunsetEpochSec - 3 * 86400 } });
    expect((await call({ token: old, rating: 3, deviceId: 'device-1234' })).status).toBe(410);
  });

  it('returns 501 when ratings are not configured', async () => {
    env.RATING_SECRET = undefined;
    expect((await call({ token: 'x', rating: 3, deviceId: 'device-1234' })).status).toBe(501);
  });
});

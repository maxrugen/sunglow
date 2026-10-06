import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
const predictEvent = vi.fn();
vi.mock('$lib/server/prediction', () => ({ predictEvent, PredictionError: class extends Error {} }));

const { POST } = await import('./+server');

function call(body: unknown) {
  const request = new Request('http://localhost/api/predict', { method: 'POST', body: JSON.stringify(body) });
  return POST({ request } as Parameters<typeof POST>[0]);
}

describe('POST /api/predict validation', () => {
  it('rejects out-of-range coordinates with 400 instead of failing later', async () => {
    expect((await call({ latitude: 95, longitude: 10 })).status).toBe(400);
    expect((await call({ latitude: 10, longitude: 200 })).status).toBe(400);
    expect((await call({ latitude: 10 })).status).toBe(400);
    expect(predictEvent).not.toHaveBeenCalled();
  });
});

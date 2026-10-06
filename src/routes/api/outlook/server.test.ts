import { describe, it, expect, vi } from 'vitest';

const predictOutlook = vi.fn(async () => ({ event: 'sunset', timeZone: 'Europe/Berlin', days: [] }));
vi.mock('#lib/server/outlook.js', () => ({ predictOutlook }));
vi.mock('#lib/server/prediction.js', () => ({ PredictionError: class extends Error {} }));

const { GET } = await import('./+server');

function call(query: string) {
  const url = new URL(`http://localhost/api/outlook?${query}`);
  return GET({ url } as unknown as Parameters<typeof GET>[0]);
}

describe('GET /api/outlook', () => {
  it('validates coordinates and the event before fetching anything', async () => {
    expect((await call('lat=95&lon=10')).status).toBe(400);
    expect((await call('lat=52.5')).status).toBe(400);
    expect((await call('lat=52.5&lon=13.4&event=noon')).status).toBe(400);
    expect(predictOutlook).not.toHaveBeenCalled();
  });

  it('defaults to sunsets and caches briefly', async () => {
    const res = await call('lat=52.52&lon=13.41');
    expect(res.status).toBe(200);
    expect(predictOutlook).toHaveBeenCalledWith({ latitude: 52.52, longitude: 13.41, event: 'sunset' });
    expect(res.headers.get('cache-control')).toBe('public, max-age=600');
  });
});

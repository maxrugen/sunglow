import { describe, it, expect, vi } from 'vitest';
import { GET } from './+server';

function call(q: string, fetchImpl: typeof fetch) {
  const url = new URL(`http://localhost/api/geocode?q=${encodeURIComponent(q)}`);
  return GET({ url, fetch: fetchImpl } as unknown as Parameters<typeof GET>[0]);
}

describe('GET /api/geocode', () => {
  it('maps results and lets them be cached', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ results: [{ id: 1, name: 'Berlin', country: 'Germany', latitude: 52.5, longitude: 13.4, extra: 'x' }] }))
    ) as unknown as typeof fetch;
    const res = await call('Berlin', fetchImpl);
    expect(res.headers.get('cache-control')).toContain('max-age');
    expect(await res.json()).toEqual({ results: [{ id: 1, name: 'Berlin', country: 'Germany', latitude: 52.5, longitude: 13.4 }] });
  });

  it('returns a JSON 502 when the upstream fails or times out', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const down = vi.fn(async () => new Response('busy', { status: 503 })) as unknown as typeof fetch;
    const offline = vi.fn(async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    for (const fetchImpl of [down, offline]) {
      const res = await call('Berlin', fetchImpl);
      expect(res.status).toBe(502);
      expect(await res.json()).toHaveProperty('error');
    }
  });

  it('answers empty queries without calling upstream', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await (await call('   ', fetchImpl)).json()).toEqual({ results: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

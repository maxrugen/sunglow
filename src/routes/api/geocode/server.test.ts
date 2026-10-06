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

  describe('place plus region without a comma', () => {
    // Like Open-Meteo: matches the name exactly, or "name, region" by state, state code or country code.
    const places = [
      { id: 1, name: 'Jackson', admin1: 'Mississippi', admin1Code: 'MS', countryCode: 'US', country: 'United States', latitude: 32.3, longitude: -90.18 },
      { id: 2, name: 'Jackson', admin1: 'Wyoming', admin1Code: 'WY', countryCode: 'US', country: 'United States', latitude: 43.48, longitude: -110.76 },
      { id: 3, name: 'Salt Lake City', admin1: 'Utah', admin1Code: 'UT', countryCode: 'US', country: 'United States', latitude: 40.76, longitude: -111.89 },
    ];
    const openMeteo = () =>
      vi.fn(async (input: string) => {
        const name = new URL(input).searchParams.get('name')!;
        const [place, region] = name.split(',').map((part) => part.trim());
        const results = places
          .filter((p) => p.name === place && (!region || [p.admin1, p.admin1Code, p.countryCode].includes(region)))
          .map(({ admin1Code: _a, countryCode: _c, ...p }) => p);
        return new Response(JSON.stringify(results.length ? { results } : {}));
      });
    const names = (body: { results: Array<{ name: string; admin1: string }> }) => body.results.map((r) => `${r.name}, ${r.admin1}`);

    it('finds "Jackson Wyoming" by retrying as "Jackson, Wyoming"', async () => {
      const fetchImpl = openMeteo();
      const body = await (await call('Jackson Wyoming', fetchImpl as unknown as typeof fetch)).json();
      expect(names(body)).toEqual(['Jackson, Wyoming']);
      expect(fetchImpl.mock.calls.map(([u]) => new URL(u).searchParams.get('name'))).toEqual(['Jackson Wyoming', 'Jackson, Wyoming']);
    });

    it('handles multi-word places, state codes and country aliases', async () => {
      expect(names(await (await call('Salt Lake City Utah', openMeteo() as unknown as typeof fetch)).json())).toEqual(['Salt Lake City, Utah']);
      expect(names(await (await call('Jackson WY', openMeteo() as unknown as typeof fetch)).json())).toEqual(['Jackson, Wyoming']);
      expect(names(await (await call('Jackson, USA', openMeteo() as unknown as typeof fetch)).json())).toHaveLength(2);
    });

    it('makes only one request when the plain search already finds something', async () => {
      const fetchImpl = openMeteo();
      expect(names(await (await call('Jackson', fetchImpl as unknown as typeof fetch)).json())).toHaveLength(2);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('stays empty, after at most three requests, when nothing matches', async () => {
      const fetchImpl = openMeteo();
      expect(await (await call('Nowhere At All Here', fetchImpl as unknown as typeof fetch)).json()).toEqual({ results: [] });
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    });
  });

  it('answers empty queries without calling upstream', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await (await call('   ', fetchImpl)).json()).toEqual({ results: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

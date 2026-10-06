import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { AVIATIONSTACK_API_KEY: 'key' } }));

const { GET } = await import('./+server');

function call(flight: string, date = '2026-10-07') {
  const url = new URL(`http://localhost/api/flight-lookup?flight=${flight}&date=${date}`);
  return GET({ url } as unknown as Parameters<typeof GET>[0]);
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const found = {
  data: [{ flight: { iata: 'UA2410' }, airline: { name: 'United' }, departure: { iata: 'IAD', scheduled: '2026-10-07T18:00:00+00:00' }, arrival: { iata: 'SLC', scheduled: '2026-10-07T20:58:00+00:00' } }],
};

describe('GET /api/flight-lookup', () => {
  it('serves repeat lookups from the cache, so the AviationStack quota is spent once', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(found)));
    const first = await call('UA2410');
    const second = await call('ua2410');
    expect(first.status).toBe(200);
    expect((await second.json()).departure.match.iata).toBe('IAD');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches "not found" too', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [] })));
    expect((await call('XX123')).status).toBe(404);
    expect((await call('XX123')).status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("doesn't pass upstream error messages on, and doesn't cache them", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Your monthly usage limit has been reached' } })));
    const res = await call('LH400');
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('usage limit');
    await call('LH400');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fixture from '$lib/server/__fixtures__/airlabs-routes-IAD-SLC.json';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const { GET } = await import('./+server');

function call(query: string) {
  const url = new URL(`http://localhost/api/flight-schedules?${query}`);
  return GET({ url } as unknown as Parameters<typeof GET>[0]);
}

const fetchMock = vi.fn();

beforeEach(() => {
  env.AIRLABS_API_KEY = 'test-key';
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    const flight = new URL(url).searchParams.get('flight_iata');
    const rows = flight ? fixture.response.filter((r) => r.flight_iata === flight) : fixture.response;
    return new Response(JSON.stringify({ response: rows }));
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/flight-schedules', () => {
  it('lists the flights on a route that operate that day', async () => {
    const res = await call('from=IAD&to=SLC&date=2026-10-07');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.flights.map((f: { flightIata: string; depTime: string }) => `${f.flightIata} ${f.depTime}`)).toEqual(['DL432 07:00', 'UA2410 18:00']);
    expect(body.flights[1]).toMatchObject({ arrTime: '20:58', depName: expect.any(String) });
  });

  it('finds a flight by number, including lowercase and spaces', async () => {
    const body = await (await call('flight=ua%202410&date=2026-10-07')).json();
    expect(body.flights).toHaveLength(1);
    expect(body.flights[0]).toMatchObject({ flightIata: 'UA2410', depIata: 'IAD', arrIata: 'SLC' });
  });

  it('explains when a flight does not operate that weekday', async () => {
    fetchMock.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ response: fixture.response.filter((r) => r.flight_iata === 'DL432' && r.dep_time === '06:13') }))
    );
    const body = await (await call('flight=DL432&date=2026-10-07')).json();
    expect(body.flights).toEqual([]);
    expect(body.message).toBe("DL432 doesn't fly on Wednesdays. It flies on Tuesdays.");
  });

  it('serves repeat searches from the cache (one AirLabs request per query and day)', async () => {
    await call('from=JFK&to=LAX&date=2026-10-07');
    await call('from=JFK&to=LAX&date=2026-10-08');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never leaks the API key in errors', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: { message: 'Invalid api_key' } }), { status: 401 }));
    const res = await call('from=BOS&to=SFO&date=2026-10-07');
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('test-key');
  });

  it('validates input', async () => {
    expect((await call('flight=UA2410')).status).toBe(400);
    expect((await call('flight=NOT-A-FLIGHT&date=2026-10-07')).status).toBe(400);
    expect((await call('from=IAD&to=IAD&date=2026-10-07')).status).toBe(400);
    expect((await call('date=2026-10-07')).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 501 when AirLabs is not configured', async () => {
    env.AIRLABS_API_KEY = undefined;
    expect((await call('flight=UA2410&date=2026-10-07')).status).toBe(501);
  });
});

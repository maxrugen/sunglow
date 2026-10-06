import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockEnv } from '#lib/server/test-env.js';
import fixture from '#lib/server/__fixtures__/airlabs-routes-IAD-SLC.json';
import busyRoute from '#lib/server/__fixtures__/airlabs-routes-JFK-LAX-page1.json';
import busyRouteDelta from '#lib/server/__fixtures__/airlabs-routes-JFK-LAX-DL.json';

const env = mockEnv();
vi.mock('$app/env/private', () => env);

const { GET } = await import('./+server');
const { MAX_EXPANSIONS } = await import('#lib/server/airlabs.js');

function call(query: string) {
  const url = new URL(`http://localhost/api/flight-schedules?${query}`);
  return GET({ url } as unknown as Parameters<typeof GET>[0]);
}

const fetchMock = vi.fn();

beforeEach(() => {
  env.AIRLABS_API_KEY = 'test-key';
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    // Like AirLabs: flight numbers only match the exact canonical code.
    const params = new URL(url).searchParams;
    const iata = params.get('flight_iata');
    const icao = params.get('flight_icao');
    // JFK → LAX is the recorded busy route: cut short unfiltered, complete per airline.
    if (params.get('dep_iata') === 'JFK' && params.get('arr_iata') === 'LAX') {
      const airline = params.get('airline_iata');
      if (!airline) return new Response(JSON.stringify(busyRoute));
      if (airline === 'DL') return new Response(JSON.stringify(busyRouteDelta));
      return new Response(JSON.stringify({ request: { has_more: false }, response: [] }));
    }
    const rows = iata
      ? fixture.response.filter((r) => r.flight_iata === iata)
      : icao
        ? fixture.response.filter((r) => r.flight_icao === icao)
        : fixture.response;
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

  // Each test uses a flight number no other test queried: results are cached per number.
  const airlabsParam = (name: string) => new URL(fetchMock.mock.calls[0][0]).searchParams.get(name);
  const airlabsFlightParam = () => airlabsParam('flight_iata');

  it('finds zero-padded flight numbers by asking AirLabs for the canonical one', async () => {
    const body = await (await call('flight=LH08936&date=2026-10-07')).json();
    expect(airlabsFlightParam()).toBe('LH8936');
    expect(body.flights).toHaveLength(1);
    expect(body.flights[0]).toMatchObject({ flightIata: 'UA2410', codeshares: ['LH8936'] });
  });

  it('keeps trailing zeros while dropping leading ones (WS08650 is WS8650, not WS865)', async () => {
    const body = await (await call('flight=ws%2008650&date=2026-10-07')).json();
    expect(airlabsFlightParam()).toBe('WS8650');
    expect(body.flights.map((f: { flightIata: string }) => f.flightIata)).toEqual(['DL432']);
  });

  it('looks up ICAO flight numbers (UAL0108 style) with flight_icao', async () => {
    const body = await (await call('flight=ual%2002410&date=2026-10-07')).json();
    expect(airlabsParam('flight_icao')).toBe('UAL2410');
    expect(airlabsParam('flight_iata')).toBeNull();
    expect(body.flights.map((f: { flightIata: string }) => f.flightIata)).toEqual(['UA2410']);
  });

  const airlineParams = () => fetchMock.mock.calls.map(([url]) => new URL(url).searchParams.get('airline_iata'));

  it('fills in a cut-short route with the airlines its codeshares point to', async () => {
    const res = await call('from=JFK&to=LAX&date=2026-10-16');
    const body = await res.json();
    const listed = body.flights.map((f: { flightIata: string; depTime: string }) => `${f.flightIata} ${f.depTime}`);
    expect(res.status).toBe(200);
    // The first page only reaches airline "AM"; its Air France/Aeroméxico codeshares point to Delta.
    expect(airlineParams()).toEqual([null, 'DL']);
    expect(listed).toEqual(expect.arrayContaining(['AA1 08:30', 'DL742 07:00', 'DL1915 19:00', 'DL773 09:25']));
    // The complete Delta list replaces the partial one from codeshares: one entry per flight.
    expect(new Set(listed.map((l: string) => l.split(' ')[0])).size).toBe(listed.length);
    expect(body.flights.find((f: { flightIata: string }) => f.flightIata === 'DL742')).toMatchObject({ airlineName: 'Delta Air Lines' });
    expect(body.incomplete).toBe(true);
    expect(body.message).toBe('Busy route: some airlines may be missing. If yours is, pick your airline or search by flight number.');
  });

  it('caps the extra requests for a cut-short route', async () => {
    const codeshares = Array.from({ length: 6 }, (_, i) => ({
      ...busyRoute.response[30],
      cs_airline_iata: `X${i}`,
      cs_flight_iata: `X${i}100`,
    }));
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ ...busyRoute, response: codeshares })));
    await call('from=EWR&to=SFO&date=2026-10-16');
    expect(fetchMock).toHaveBeenCalledTimes(1 + MAX_EXPANSIONS);
  });

  it('searches one airline on a route, by code or name from the picker', async () => {
    const body = await (await call('from=JFK&to=LAX&airline=dl&date=2026-10-16')).json();
    expect(body.flights.length).toBeGreaterThan(5);
    expect(body.flights.every((f: { airlineIata: string }) => f.airlineIata === 'DL')).toBe(true);
    expect(body.incomplete).toBeUndefined();
    expect(body.message).toBeUndefined();
  });

  it('names the airline when it has no flights on the route', async () => {
    const body = await (await call('from=JFK&to=LAX&airline=B6&date=2026-10-16')).json();
    expect(airlineParams()).toEqual(['B6']);
    expect(body.message).toBe('No timetable found for JetBlue Airways on JFK → LAX.');
  });

  it('suggests flight-number search when a cut-short route has nothing that day', async () => {
    fetchMock.mockImplementationOnce(
      async () => new Response(JSON.stringify({ ...busyRoute, response: busyRoute.response.slice(0, 0) }))
    );
    const body = await (await call('from=JFK&to=SFO&date=2026-10-07')).json();
    expect(body.flights).toEqual([]);
    expect(body.message).toBe('JFK → SFO is a busy route and the timetable only lists some airlines. Pick your airline, or search by flight number.');
  });

  it('does not flag complete lists', async () => {
    const body = await (await call('from=IAD&to=SLC&date=2026-10-08')).json();
    expect(body.incomplete).toBeUndefined();
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
    await call('from=ORD&to=DEN&date=2026-10-07');
    await call('from=ORD&to=DEN&date=2026-10-08');
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
    expect((await call('flight=UA10800&date=2026-10-07')).status).toBe(400);
    expect((await call('from=IAD&to=IAD&date=2026-10-07')).status).toBe(400);
    expect((await call('from=IAD&to=SLC&airline=Delta&date=2026-10-07')).status).toBe(400);
    expect((await call('from=IAD&to=SLC&airline=12&date=2026-10-07')).status).toBe(400);
    expect((await call('date=2026-10-07')).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 501 when AirLabs is not configured', async () => {
    env.AIRLABS_API_KEY = undefined;
    expect((await call('flight=UA2410&date=2026-10-07')).status).toBe(501);
  });
});

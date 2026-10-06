import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './+server';

function call(body: Record<string, string>) {
  const request = new Request('http://localhost/api/predict-flight', { method: 'POST', body: JSON.stringify(body) });
  return POST({ request } as Parameters<typeof POST>[0]);
}

beforeEach(() => {
  // No weather needed: sightings are found from geometry, scores are just left out.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/predict-flight cache', () => {
  it('does not serve one flight’s answer for another departing in the same hour', async () => {
    const guess = await (await call({ depIata: 'IAD', arrIata: 'SLC', depTime: '2026-10-07T18:05', arrTime: '2026-10-07T20:40' })).json();
    const actual = await (await call({ depIata: 'IAD', arrIata: 'SLC', depTime: '2026-10-07T18:00', arrTime: '2026-10-07T20:58' })).json();
    expect(guess.route.departureTime).toBe('2026-10-07T22:05:00.000Z');
    expect(actual.route.departureTime).toBe('2026-10-07T22:00:00.000Z');
    expect(actual.route.arrivalTime).toBe('2026-10-08T02:58:00.000Z');
  });
});

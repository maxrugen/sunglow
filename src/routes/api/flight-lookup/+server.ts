import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { airportByIata } from '$lib/server/airports';
import { BoundedCache } from '$lib/server/bounded-cache';

/**
 * Schedules rarely change within hours, and every AviationStack call counts
 * against a small monthly quota, so repeat lookups are served from memory.
 */
const cache = new BoundedCache<{ status: number; body: unknown }>(6 * 3600 * 1000, 200);
/** "Not found" may just mean the schedule isn't published yet; retry sooner. */
const NOT_FOUND_TTL_MS = 3600 * 1000;

/**
 * Optional flight number lookup using AviationStack API.
 * Only works when AVIATIONSTACK_API_KEY env var is set.
 *
 * GET /api/flight-lookup?flight=AA1004&date=2026-04-15
 */
export const GET: RequestHandler = async ({ url }) => {
  const apiKey = env.AVIATIONSTACK_API_KEY;
  if (!apiKey) {
    return json(
      { error: 'Flight lookup is not configured. Please enter airports manually.' },
      { status: 501 }
    );
  }

  const flight = url.searchParams.get('flight')?.trim().toUpperCase();
  const date = url.searchParams.get('date')?.trim();

  if (!flight || flight.length < 3 || flight.length > 10) {
    return json({ error: 'Invalid flight code. Use IATA format like AA1004.' }, { status: 400 });
  }

  // Validate date format if provided
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: 'Invalid date format. Use YYYY-MM-DD.' }, { status: 400 });
  }

  const cacheKey = `${flight}|${date ?? ''}`;
  const cached = cache.get(cacheKey);
  if (cached) return json(cached.body, { status: cached.status });

  try {
    const params = new URLSearchParams({
      access_key: apiKey,
      flight_iata: flight,
    });
    if (date) {
      params.set('flight_date', date);
    }

    const res = await fetch(`https://api.aviationstack.com/v1/flights?${params.toString()}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error('[flight-lookup] upstream status', res.status);
      return json({ error: 'Flight lookup service unavailable.' }, { status: 502 });
    }

    const data = await res.json();
    if (data?.error) {
      // Upstream messages can mention our plan/quota; log them instead of passing them on.
      console.error('[flight-lookup] upstream error', data.error);
      return json({ error: 'Flight lookup failed.' }, { status: 502 });
    }

    const flights = data?.data;
    if (!Array.isArray(flights) || flights.length === 0) {
      const body = { error: 'No flights found for this code.' };
      cache.set(cacheKey, { status: 404, body }, NOT_FOUND_TTL_MS);
      return json(body, { status: 404 });
    }

    // Take the first matching flight
    const f = flights[0];
    const body = {
      flight: {
        iata: f.flight?.iata || flight,
        airline: f.airline?.name || '',
      },
      departure: {
        iata: f.departure?.iata || '',
        airport: f.departure?.airport || '',
        scheduled: f.departure?.scheduled || '',
        timezone: f.departure?.timezone || '',
        match: airportByIata(f.departure?.iata ?? '') ?? null,
      },
      arrival: {
        iata: f.arrival?.iata || '',
        airport: f.arrival?.airport || '',
        scheduled: f.arrival?.scheduled || '',
        timezone: f.arrival?.timezone || '',
        match: airportByIata(f.arrival?.iata ?? '') ?? null,
      },
    };
    cache.set(cacheKey, { status: 200, body });
    return json(body);
  } catch (e: unknown) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    console.error('[flight-lookup]', e);
    return json({ error: timedOut ? 'Flight lookup timed out.' : 'Flight lookup failed.' }, { status: 502 });
  }
};

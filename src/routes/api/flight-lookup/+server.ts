import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Optional flight number lookup using AviationStack API.
 * Only works when AVIATIONSTACK_API_KEY env var is set.
 *
 * GET /api/flight-lookup?flight=AA1004&date=2026-04-15
 */
export const GET: RequestHandler = async ({ url }) => {
  const apiKey = process.env.AVIATIONSTACK_API_KEY;
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

  try {
    const params = new URLSearchParams({
      access_key: apiKey,
      flight_iata: flight,
    });
    if (date) {
      params.set('flight_date', date);
    }

    const apiUrl = `https://api.aviationstack.com/v1/flights?${params.toString()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      return json({ error: 'Flight lookup service unavailable.' }, { status: 502 });
    }

    const data = await res.json();

    if (data?.error) {
      return json({ error: data.error.message || 'Flight lookup failed.' }, { status: 502 });
    }

    const flights = data?.data;
    if (!Array.isArray(flights) || flights.length === 0) {
      return json({ error: 'No flights found for this code.' }, { status: 404 });
    }

    // Take the first matching flight
    const f = flights[0];
    return json({
      flight: {
        iata: f.flight?.iata || flight,
        airline: f.airline?.name || '',
      },
      departure: {
        iata: f.departure?.iata || '',
        airport: f.departure?.airport || '',
        scheduled: f.departure?.scheduled || '',
        timezone: f.departure?.timezone || '',
      },
      arrival: {
        iata: f.arrival?.iata || '',
        airport: f.arrival?.airport || '',
        scheduled: f.arrival?.scheduled || '',
        timezone: f.arrival?.timezone || '',
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error && e.name === 'AbortError'
      ? 'Flight lookup timed out.'
      : 'Flight lookup failed.';
    return json({ error: message }, { status: 502 });
  }
};

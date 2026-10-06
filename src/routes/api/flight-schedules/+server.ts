import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { airlabsConfigured, fetchSchedules, operatesOn, weekdayOf, type RouteQuery } from '$lib/server/airlabs';
import { airportByIata } from '$lib/server/airports';

const FLIGHT = /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/;
const IATA = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_NAMES = { mon: 'Mondays', tue: 'Tuesdays', wed: 'Wednesdays', thu: 'Thursdays', fri: 'Fridays', sat: 'Saturdays', sun: 'Sundays' };

/**
 * GET /api/flight-schedules?flight=UA2410&date=2026-10-07
 * GET /api/flight-schedules?from=IAD&to=SLC&date=2026-10-07
 *
 * Flights from the AirLabs timetable that operate on `date` (the local
 * departure date), with local departure/arrival times ready for
 * /api/predict-flight.
 */
export const GET: RequestHandler = async ({ url }) => {
  if (!airlabsConfigured()) {
    return json({ error: 'Flight search is not configured. Enter the times manually.' }, { status: 501 });
  }

  const flight = url.searchParams.get('flight')?.trim().toUpperCase().replace(/\s+/g, '');
  const from = url.searchParams.get('from')?.trim().toUpperCase();
  const to = url.searchParams.get('to')?.trim().toUpperCase();
  const date = url.searchParams.get('date')?.trim() ?? '';

  if (!DATE.test(date) || Number.isNaN(Date.parse(date))) {
    return json({ error: 'Pick a date.' }, { status: 400 });
  }
  let query: RouteQuery;
  if (flight) {
    if (!FLIGHT.test(flight)) return json({ error: 'Use a flight number like UA2410.' }, { status: 400 });
    query = { flight };
  } else if (from && to) {
    if (!IATA.test(from) || !IATA.test(to)) return json({ error: 'Pick both airports.' }, { status: 400 });
    if (from === to) return json({ error: 'Departure and arrival airports are the same.' }, { status: 400 });
    query = { from, to };
  } else {
    return json({ error: 'Enter a flight number, or pick both airports.' }, { status: 400 });
  }

  const schedules = await fetchSchedules(query);
  if (!schedules) {
    return json({ error: "Flight search isn't available right now. Try again later, or enter the times manually." }, { status: 502 });
  }

  // Only flights we can actually predict (both airports in our dataset).
  const known = schedules.filter((f) => airportByIata(f.depIata) && airportByIata(f.arrIata));
  const flights = known.filter((f) => operatesOn(f, date));

  let message: string | undefined;
  if (flights.length === 0) {
    if (known.length === 0) {
      message = flight ? `No timetable found for ${flight}.` : `No timetable found for ${from} → ${to}.`;
    } else if (flight) {
      const days = [...new Set(known.flatMap((f) => f.days))];
      message = `${flight} doesn't fly on ${DAY_NAMES[weekdayOf(date)]}.${days.length ? ` It flies on ${days.map((d) => DAY_NAMES[d]).join(', ')}.` : ''}`;
    } else {
      message = `No flights from ${from} to ${to} on that day.`;
    }
  }

  return json(
    {
      date,
      flights: flights.map((f) => ({
        ...f,
        depName: airportByIata(f.depIata)?.name,
        arrName: airportByIata(f.arrIata)?.name,
      })),
      message,
    },
    { headers: { 'Cache-Control': 'private, max-age=3600' } }
  );
};

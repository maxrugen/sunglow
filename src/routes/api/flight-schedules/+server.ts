import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { airlabsConfigured, fetchSchedules, flightsOn, weekdayOf, type RouteQuery } from '#lib/server/airlabs.js';
import { airportByIata } from '#lib/server/airports.js';
import { airlineByIata } from '#lib/server/airlines.js';
import { parseFlightNumber } from '#lib/flight-number.js';

const IATA = /^[A-Z]{3}$/;
const AIRLINE = /^(?=.*[A-Z])[A-Z0-9]{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_NAMES = { mon: 'Mondays', tue: 'Tuesdays', wed: 'Wednesdays', thu: 'Thursdays', fri: 'Fridays', sat: 'Saturdays', sun: 'Sundays' };

/**
 * GET /api/flight-schedules?flight=UA2410&date=2026-10-07   (IATA or ICAO, e.g. UAL2410)
 * GET /api/flight-schedules?from=IAD&to=SLC&date=2026-10-07[&airline=UA]
 *
 * Flights from the AirLabs timetable that operate on `date` (the local
 * departure date), with local departure/arrival times ready for
 * /api/predict-flight.
 */
export const GET: RequestHandler = async ({ url }) => {
  if (!airlabsConfigured()) {
    return json({ error: 'Flight search is not configured. Enter the times manually.' }, { status: 501 });
  }

  const rawFlight = url.searchParams.get('flight')?.trim();
  const from = url.searchParams.get('from')?.trim().toUpperCase();
  const to = url.searchParams.get('to')?.trim().toUpperCase();
  const airline = url.searchParams.get('airline')?.trim().toUpperCase() || undefined;
  const date = url.searchParams.get('date')?.trim() ?? '';

  if (!DATE.test(date) || Number.isNaN(Date.parse(date))) {
    return json({ error: 'Pick a date.' }, { status: 400 });
  }
  const parsed = rawFlight ? parseFlightNumber(rawFlight) : null;
  const flight = parsed?.code;
  let query: RouteQuery;
  if (rawFlight) {
    if (!parsed) return json({ error: 'Use a flight number like UA2410 or UAL2410.' }, { status: 400 });
    query = { flight: parsed };
  } else if (from && to) {
    if (!IATA.test(from) || !IATA.test(to)) return json({ error: 'Pick both airports.' }, { status: 400 });
    if (from === to) return json({ error: 'Departure and arrival airports are the same.' }, { status: 400 });
    if (airline && !AIRLINE.test(airline)) return json({ error: 'Pick an airline from the list.' }, { status: 400 });
    query = { from, to, airline };
  } else {
    return json({ error: 'Enter a flight number, or pick both airports.' }, { status: 400 });
  }

  const schedules = await fetchSchedules(query);
  if (!schedules) {
    return json({ error: "Flight search isn't available right now. Try again later, or enter the times manually." }, { status: 502 });
  }

  // Only flights we can actually predict (both airports in our dataset).
  const known = schedules.flights.filter((f) => airportByIata(f.depIata) && airportByIata(f.arrIata));
  const flights = flightsOn(known, date);

  const airlineName = airline ? (airlineByIata(airline)?.name ?? airline) : undefined;
  const routeLabel = `${from} → ${to}`;
  let message: string | undefined;
  if (!flight && schedules.incomplete) {
    // AirLabs cut the list short: an airline or a flight number narrows the search enough.
    message = airline
      ? `Even for ${airlineName}, ${routeLabel} only lists some flights. If yours is missing, search by flight number.`
      : flights.length === 0
        ? `${routeLabel} is a busy route and the timetable only lists some airlines. Pick your airline, or search by flight number.`
        : 'Busy route: some airlines may be missing. If yours is, pick your airline or search by flight number.';
  } else if (flights.length === 0) {
    if (known.length === 0) {
      message = flight
        ? `No timetable found for ${flight}.`
        : `No timetable found for ${airlineName ? `${airlineName} on ` : ''}${routeLabel}.`;
    } else if (flight) {
      const days = [...new Set(known.flatMap((f) => f.days))];
      message = `${flight} doesn't fly on ${DAY_NAMES[weekdayOf(date)]}.${days.length ? ` It flies on ${days.map((d) => DAY_NAMES[d]).join(', ')}.` : ''}`;
    } else {
      message = `No ${airlineName ? `${airlineName} ` : ''}flights from ${from} to ${to} on that day.`;
    }
  }

  return json(
    {
      date,
      flights: flights.map((f) => ({
        ...f,
        airlineName: airlineByIata(f.airlineIata)?.name,
        depName: airportByIata(f.depIata)?.name,
        arrName: airportByIata(f.arrIata)?.name,
      })),
      message,
      incomplete: schedules.incomplete || undefined,
    },
    { headers: { 'Cache-Control': 'private, max-age=3600' } }
  );
};

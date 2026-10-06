import * as env from '$app/env/private';
import { BoundedCache } from '#lib/server/bounded-cache.js';
import type { FlightNumber } from '#lib/flight-number.js';

/**
 * Flight timetables from AirLabs' routes database: which flights run on a
 * route, at what local times and on which weekdays. It's a timetable, not a
 * per-date schedule, which is what a sunset prediction needs (and a single
 * request answers both "flight number" and "route" searches).
 */

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type ScheduledFlight = {
  /** Operating flight, e.g. "UA2410". */
  flightIata: string;
  airlineIata: string;
  depIata: string;
  arrIata: string;
  /** Local wall-clock times at each airport, "HH:MM". */
  depTime: string;
  arrTime: string;
  durationMin?: number;
  days: Weekday[];
  /** Marketing flight numbers sold on the same flight, e.g. ["LH8936"]. */
  codeshares: string[];
  /** When AirLabs last saw this timetable entry (ISO), to prefer current entries over stale ones. */
  updated?: string;
};

type RouteRow = {
  flight_iata?: string | null;
  airline_iata?: string | null;
  cs_flight_iata?: string | null;
  dep_iata?: string | null;
  arr_iata?: string | null;
  dep_time?: string | null;
  arr_time?: string | null;
  duration?: number | null;
  days?: string[] | null;
  updated?: string | null;
};

const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const TIME = /^\d{2}:\d{2}$/;

export function airlabsConfigured(): boolean {
  return Boolean(env.AIRLABS_API_KEY);
}

/** Weekday of a "YYYY-MM-DD" date (the local departure date). */
export function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * Turn AirLabs rows into one entry per operating flight. Codeshare rows point
 * at their operating flight (`cs_flight_iata`) and are folded into it; a
 * codeshare whose operating row isn't in the result (e.g. when searching by
 * the codeshare number) becomes the operating flight it points to.
 */
export function toScheduledFlights(rows: RouteRow[]): ScheduledFlight[] {
  const flights = new Map<string, ScheduledFlight>();
  const keyOf = (flight: string, dep: string) => `${flight}|${dep}`;
  const valid = rows.filter(
    (r) => r.dep_iata && r.arr_iata && r.dep_time && r.arr_time && TIME.test(r.dep_time) && TIME.test(r.arr_time) && (r.flight_iata || r.cs_flight_iata)
  );

  const upsert = (flightIata: string, r: RouteRow) => {
    const key = keyOf(flightIata, r.dep_time!);
    const existing = flights.get(key);
    const days = (r.days ?? []).filter((d): d is Weekday => (WEEKDAYS as string[]).includes(d));
    if (existing) {
      existing.days = [...new Set([...existing.days, ...days])];
      return existing;
    }
    const flight: ScheduledFlight = {
      flightIata,
      airlineIata: flightIata.slice(0, 2),
      depIata: r.dep_iata!.toUpperCase(),
      arrIata: r.arr_iata!.toUpperCase(),
      depTime: r.dep_time!,
      arrTime: r.arr_time!,
      durationMin: r.duration ?? undefined,
      days,
      codeshares: [],
      updated: r.updated ?? undefined,
    };
    flights.set(key, flight);
    return flight;
  };

  // Operating flights first, so codeshares can attach to them.
  for (const r of valid.filter((r) => !r.cs_flight_iata && r.flight_iata)) upsert(r.flight_iata!, r);
  for (const r of valid.filter((r) => r.cs_flight_iata)) {
    const operating = flights.get(keyOf(r.cs_flight_iata!, r.dep_time!)) ?? upsert(r.cs_flight_iata!, r);
    if (r.flight_iata && !operating.codeshares.includes(r.flight_iata)) operating.codeshares.push(r.flight_iata);
  }

  return [...flights.values()].sort((a, b) => a.depTime.localeCompare(b.depTime) || a.flightIata.localeCompare(b.flightIata));
}

export function operatesOn(flight: ScheduledFlight, date: string): boolean {
  return flight.days.length === 0 || flight.days.includes(weekdayOf(date));
}

/**
 * The flights operating on `date`, one entry per flight number. A flight
 * number can have several timetable entries (DL1915: 16:40 Tue/Wed, 19:00
 * Mon/Thu/Fri/Sun, 19:05 Sat). They normally cover different weekdays, but
 * after a schedule change an old entry can overlap the new one; then the most
 * recently updated entry wins.
 */
export function flightsOn(flights: ScheduledFlight[], date: string): ScheduledFlight[] {
  const best = new Map<string, ScheduledFlight>();
  for (const f of flights) {
    if (!operatesOn(f, date)) continue;
    const current = best.get(f.flightIata);
    if (!current || (f.updated ?? '') > (current.updated ?? '')) best.set(f.flightIata, f);
  }
  return flights.filter((f) => best.get(f.flightIata) === f);
}

export type RouteQuery = { flight: FlightNumber } | { from: string; to: string };

export type Schedules = {
  flights: ScheduledFlight[];
  /**
   * AirLabs returned only part of the timetable. Free keys get the first 50
   * rows and can't page further (`offset` returns nothing), and codeshares
   * count as rows, so busy routes (JFK→LAX: ~400 rows) come back cut short.
   */
  incomplete: boolean;
};

/** Timetables change rarely; caching protects the monthly request quota. */
const cache = new BoundedCache<Schedules>(24 * 3600 * 1000, 300);

/**
 * Timetable entries for a flight number or a route, or null if AirLabs is
 * unavailable. One request per query and day (cached).
 */
export async function fetchSchedules(query: RouteQuery): Promise<Schedules | null> {
  const key = env.AIRLABS_API_KEY;
  if (!key) return null;
  const params = new URLSearchParams(
    'flight' in query
      ? { [query.flight.system === 'icao' ? 'flight_icao' : 'flight_iata']: query.flight.code }
      : { dep_iata: query.from, arr_iata: query.to }
  );
  const cacheKey = params.toString();
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  params.set('api_key', key);
  try {
    const res = await fetch(`https://airlabs.co/api/v9/routes?${params.toString()}`, {
      signal: AbortSignal.timeout(10000),
    });
    const body = (await res.json().catch(() => null)) as
      | { response?: RouteRow[]; error?: unknown; request?: { has_more?: boolean } }
      | null;
    if (!res.ok || !body || body.error || !Array.isArray(body.response)) {
      // Log the error code/message only; the request URL contains the key.
      console.error('[airlabs] routes failed', res.status, JSON.stringify(body?.error ?? null).slice(0, 200));
      return null;
    }
    const schedules = { flights: toScheduledFlights(body.response), incomplete: body.request?.has_more === true };
    cache.set(cacheKey, schedules);
    return schedules;
  } catch (err) {
    console.error('[airlabs] routes request failed', (err as Error).name);
    return null;
  }
}

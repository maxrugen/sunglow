import airportsData from '$lib/data/airports.json';
import type { Airport } from '$lib/types';

// Server-only so the ~570 KB dataset stays out of the client bundle.
const airports = airportsData as Airport[];
const byIata = new Map(airports.map((a) => [a.iata, a]));

export function airportByIata(iata: string): Airport | undefined {
  return byIata.get(iata.trim().toUpperCase());
}

/** Exact IATA match first, then IATA prefix, then city/name substring. */
export function searchAirports(query: string, limit = 8): Airport[] {
  const q = query.trim().toUpperCase();
  if (q.length < 2) return [];
  const exact = byIata.get(q);
  if (exact) return [exact];
  const byPrefix = airports.filter((a) => a.iata.startsWith(q));
  const byName = airports.filter(
    (a) => !a.iata.startsWith(q) && (a.name.toUpperCase().includes(q) || a.city.toUpperCase().includes(q))
  );
  return [...byPrefix, ...byName].slice(0, limit);
}

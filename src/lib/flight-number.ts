/** A flight number in canonical form, and which coding system it uses. */
export type FlightNumber = { system: 'iata' | 'icao'; code: string };

// IATA airline codes are 2 characters and may contain a digit (9W, U2);
// ICAO codes are 3 letters. The character after the airline code tells them
// apart: IATA numbers start right after 2 characters, ICAO ones after 3 letters.
const IATA = /^([A-Z0-9]{2})0*(\d{1,4})([A-Z]?)$/;
const ICAO = /^([A-Z]{3})0*(\d{1,4})([A-Z]?)$/;

/**
 * Parses what people type ("ua 0108", "UAL0108") into the canonical form
 * timetables match ("UA108", "UAL108"): airline code, the number without
 * leading zeros, an optional suffix letter. Tickets and boarding passes often
 * pad the number to 4 digits. Returns null if it isn't a flight number.
 */
export function parseFlightNumber(input: string): FlightNumber | null {
  const compact = input.toUpperCase().replace(/[\s-]+/g, '');
  const iata = IATA.exec(compact);
  // A two-digit "airline" ("12345") is a typo, not a flight.
  if (iata && /[A-Z]/.test(iata[1])) return { system: 'iata', code: iata[1] + iata[2] + iata[3] };
  const icao = ICAO.exec(compact);
  if (icao) return { system: 'icao', code: icao[1] + icao[2] + icao[3] };
  return null;
}

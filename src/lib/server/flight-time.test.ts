import { describe, it, expect } from 'vitest';
import { timeZoneAt, zonedToUtcMs, resolveFlightTimes } from './flight-time';

const iso = (ms: number) => new Date(ms).toISOString();

describe('timeZoneAt()', () => {
  it('resolves major airports', () => {
    expect(timeZoneAt(51.47, -0.45)).toBe('Europe/London'); // LHR
    expect(timeZoneAt(40.64, -73.78)).toBe('America/New_York'); // JFK
    expect(timeZoneAt(-33.94, 151.18)).toBe('Australia/Sydney'); // SYD
  });
});

describe('zonedToUtcMs()', () => {
  it('converts summer and winter wall-clock times', () => {
    expect(iso(zonedToUtcMs(2026, 7, 1, 12, 0, 0, 'Europe/Berlin'))).toBe('2026-07-01T10:00:00.000Z');
    expect(iso(zonedToUtcMs(2026, 1, 1, 12, 0, 0, 'Europe/Berlin'))).toBe('2026-01-01T11:00:00.000Z');
  });

  it('handles the day after a DST switch', () => {
    // US DST starts 2026-03-08; New York is UTC-4 afterwards.
    expect(iso(zonedToUtcMs(2026, 3, 8, 12, 0, 0, 'America/New_York'))).toBe('2026-03-08T16:00:00.000Z');
  });
});

describe('resolveFlightTimes()', () => {
  it('reads departure and arrival in their own airport zones (eastbound overnight)', () => {
    // JFK 19:00 EDT -> LHR 07:00 BST next morning.
    const r = resolveFlightTimes('2026-06-10T19:00', '2026-06-10T07:00', 'America/New_York', 'Europe/London');
    expect(r && iso(r.depMs)).toBe('2026-06-10T23:00:00.000Z');
    expect(r && iso(r.arrMs)).toBe('2026-06-11T06:00:00.000Z');
  });

  it('handles westbound same-day arrivals', () => {
    // LHR 10:00 BST -> JFK 13:00 EDT, ~8h flight.
    const r = resolveFlightTimes('2026-06-10T10:00', '2026-06-10T13:00', 'Europe/London', 'America/New_York');
    expect(r && iso(r.depMs)).toBe('2026-06-10T09:00:00.000Z');
    expect(r && iso(r.arrMs)).toBe('2026-06-10T17:00:00.000Z');
  });

  it('handles arrival on an earlier calendar date across the date line', () => {
    // SYD 01:00 AEST Tue -> LAX 20:00 PDT Mon (previous date).
    const r = resolveFlightTimes('2026-06-09T01:00', '2026-06-09T20:00', 'Australia/Sydney', 'America/Los_Angeles');
    expect(r && iso(r.depMs)).toBe('2026-06-08T15:00:00.000Z');
    expect(r && iso(r.arrMs)).toBe('2026-06-09T03:00:00.000Z');
  });

  it('handles arrival two calendar dates later across the date line', () => {
    // LAX 23:00 PDT -> SYD 07:00 AEST two dates later (~15h).
    const r = resolveFlightTimes('2026-06-09T23:00', '2026-06-09T07:00', 'America/Los_Angeles', 'Australia/Sydney');
    expect(r && iso(r.depMs)).toBe('2026-06-10T06:00:00.000Z');
    expect(r && iso(r.arrMs)).toBe('2026-06-10T21:00:00.000Z');
  });

  it('treats strings with an explicit offset as absolute', () => {
    const r = resolveFlightTimes('2026-04-12T17:00:00Z', '2026-04-12T18:00:00Z', 'Europe/Berlin', 'Europe/Berlin');
    expect(r && iso(r.depMs)).toBe('2026-04-12T17:00:00.000Z');
    expect(r && iso(r.arrMs)).toBe('2026-04-12T18:00:00.000Z');
  });

  it('rejects malformed input', () => {
    expect(resolveFlightTimes('tomorrow', '2026-06-10T07:00', 'UTC', 'UTC')).toBeNull();
    expect(resolveFlightTimes('2026-06-10T07:00', 'later', 'UTC', 'UTC')).toBeNull();
  });
});

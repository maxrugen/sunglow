import { describe, it, expect } from 'vitest';
import fixture from './__fixtures__/airlabs-routes-IAD-SLC.json';
import delta from './__fixtures__/airlabs-routes-JFK-LAX-DL.json';
import { flightsOn, operatesOn, toScheduledFlights, weekdayOf } from './airlabs';

// Recorded AirLabs /routes response for IAD → SLC (no API key inside).
const flights = toScheduledFlights(fixture.response);

describe('toScheduledFlights()', () => {
  it('keeps one entry per operating flight and departure time, sorted by time', () => {
    expect(flights.map((f) => `${f.flightIata} ${f.depTime}`)).toEqual(['DL432 06:13', 'DL432 07:00', 'UA2410 18:00']);
  });

  it('folds codeshares into the operating flight', () => {
    const ua = flights.find((f) => f.flightIata === 'UA2410')!;
    expect(ua).toMatchObject({ depIata: 'IAD', arrIata: 'SLC', depTime: '18:00', arrTime: '20:58', durationMin: 298, codeshares: ['LH8936'] });
    const dl = flights.find((f) => f.flightIata === 'DL432' && f.depTime === '07:00')!;
    expect(dl.codeshares.sort()).toEqual(['AM3432', 'KE3291', 'WS8650']);
  });

  it('drops rows without a flight number', () => {
    expect(flights.every((f) => f.flightIata)).toBe(true);
  });

  it('resolves a codeshare-only result to its operating flight', () => {
    const [lh] = toScheduledFlights(fixture.response.filter((r) => r.flight_iata === 'LH8936'));
    expect(lh).toMatchObject({ flightIata: 'UA2410', codeshares: ['LH8936'], depTime: '18:00' });
  });
});

describe('weekdays', () => {
  it('reads the weekday of a local date', () => {
    expect(weekdayOf('2026-10-07')).toBe('wed');
    expect(weekdayOf('2026-10-06')).toBe('tue');
  });

  it('filters flights to the ones operating that day', () => {
    const wednesday = flights.filter((f) => operatesOn(f, '2026-10-07')).map((f) => `${f.flightIata} ${f.depTime}`);
    const tuesday = flights.filter((f) => operatesOn(f, '2026-10-06')).map((f) => `${f.flightIata} ${f.depTime}`);
    expect(wednesday).toEqual(['DL432 07:00', 'UA2410 18:00']);
    expect(tuesday).toEqual(['DL432 06:13', 'UA2410 18:00']);
  });
});

describe('flight numbers with several timetable entries', () => {
  // Recorded JFK → LAX, Delta only. DL1915 has three entries (16:40 Tue/Wed,
  // 19:00 Mon/Thu/Fri/Sun, 19:05 Sat): weekday variants, never two on one day.
  const dl = toScheduledFlights(delta.response);
  const on = (flight: string, date: string) =>
    dl.filter((f) => f.flightIata === flight && operatesOn(f, date)).map((f) => f.depTime);

  it('picks exactly one departure for the date entered', () => {
    expect(on('DL1915', '2026-10-16')).toEqual(['19:00']); // Friday
    expect(on('DL1915', '2026-10-17')).toEqual(['19:05']); // Saturday
    expect(on('DL1915', '2026-10-20')).toEqual(['16:40']); // Tuesday
  });

  it('never lists a flight twice on the same day', () => {
    for (const date of ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']) {
      const numbers = flightsOn(dl, date).map((f) => f.flightIata);
      expect(new Set(numbers).size, date).toBe(numbers.length);
      expect(numbers.length, date).toBe(dl.filter((f) => operatesOn(f, date)).length);
    }
  });

  it('keeps the most recently updated entry when a stale one overlaps the same day', () => {
    const [current] = dl.filter((f) => f.flightIata === 'DL1915' && f.depTime === '19:00');
    const stale = { ...current, depTime: '18:30', arrTime: '21:35', updated: '2026-03-01T00:00:00.000Z' };
    const picked = flightsOn([stale, current], '2026-10-16').map((f) => f.depTime);
    expect(picked).toEqual(['19:00']);
    expect(flightsOn([current, stale], '2026-10-16').map((f) => f.depTime)).toEqual(['19:00']);
  });
});

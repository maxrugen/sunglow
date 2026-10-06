import { describe, it, expect } from 'vitest';
import fixture from './__fixtures__/airlabs-routes-IAD-SLC.json';
import { operatesOn, toScheduledFlights, weekdayOf } from './airlabs';

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

import { describe, it, expect } from 'vitest';
import { airportByIata, searchAirports } from './airports';

describe('airportByIata()', () => {
  it('is case-insensitive', () => {
    expect(airportByIata('muc')?.iata).toBe('MUC');
    expect(airportByIata('ZZZZ')).toBeUndefined();
  });
});

describe('searchAirports()', () => {
  it('returns only the exact IATA match when there is one', () => {
    expect(searchAirports('LHR').map((a) => a.iata)).toEqual(['LHR']);
  });

  it('lists IATA prefix matches before name matches, capped at the limit', () => {
    const results = searchAirports('MU');
    expect(results.length).toBeLessThanOrEqual(8);
    expect(results[0].iata.startsWith('MU')).toBe(true);
  });

  it('matches city names', () => {
    expect(searchAirports('munich').some((a) => a.iata === 'MUC')).toBe(true);
  });

  it('ignores queries shorter than 2 characters', () => {
    expect(searchAirports('M')).toEqual([]);
  });
});

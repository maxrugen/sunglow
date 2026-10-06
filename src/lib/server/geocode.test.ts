import { describe, it, expect } from 'vitest';
import { fallbackQueries, primaryQuery } from './geocode';

describe('primaryQuery()', () => {
  it('keeps plain and comma queries as typed', () => {
    expect(primaryQuery('Berlin')).toBe('Berlin');
    expect(primaryQuery('Jackson, Wyoming')).toBe('Jackson, Wyoming');
    expect(primaryQuery('Jackson,WY')).toBe('Jackson, WY');
  });

  it('replaces country names the geocoder does not know', () => {
    expect(primaryQuery('Jackson, USA')).toBe('Jackson, US');
    expect(primaryQuery('Cambridge, uk')).toBe('Cambridge, GB');
    expect(primaryQuery('Cambridge, Great Britain')).toBe('Cambridge, GB');
  });
});

describe('fallbackQueries()', () => {
  it('tries the last word, then the last two, as a region or country', () => {
    expect(fallbackQueries('Jackson Wyoming')).toEqual(['Jackson, Wyoming']);
    expect(fallbackQueries('Salt Lake City Utah')).toEqual(['Salt Lake City, Utah', 'Salt Lake, City Utah']);
    expect(fallbackQueries('Santa Fe New Mexico')).toEqual(['Santa Fe New, Mexico', 'Santa Fe, New Mexico']);
  });

  it('maps country aliases there too', () => {
    expect(fallbackQueries('Jackson USA')[0]).toBe('Jackson, US');
    expect(fallbackQueries('Cambridge Great Britain')).toContain('Cambridge, GB');
  });

  it('has nothing to try for single words or queries that already have a comma', () => {
    expect(fallbackQueries('Jackson')).toEqual([]);
    expect(fallbackQueries('Jackson, Wyoming')).toEqual([]);
    expect(fallbackQueries('  Jackson  ')).toEqual([]);
  });
});

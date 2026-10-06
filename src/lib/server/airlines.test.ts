import { describe, it, expect } from 'vitest';
import { airlineByIata, searchAirlines } from './airlines';

const codes = (q: string) => searchAirlines(q).map((a) => a.iata);

describe('searchAirlines()', () => {
  it('finds airlines by IATA or ICAO code, case-insensitively', () => {
    expect(searchAirlines('dl')).toEqual([{ iata: 'DL', icao: 'DAL', name: 'Delta Air Lines' }]);
    expect(codes('UAL')).toEqual(['UA']);
    expect(codes('B6')).toEqual(['B6']);
    expect(codes('U2')).toEqual(['U2']);
  });

  it('finds airlines by name, prefix matches first', () => {
    expect(codes('delta')[0]).toBe('DL');
    expect(codes('jetblue')).toEqual(['B6']);
    expect(codes('United')[0]).toBe('UA');
    expect(searchAirlines('lines').length).toBeGreaterThan(1);
  });

  it('names each code after its main airline, not a sub-brand or a defunct one', () => {
    expect(airlineByIata('UA')?.name).toBe('United Airlines');
    expect(airlineByIata('LH')?.name).toBe('Lufthansa');
    expect(airlineByIata('9W')).toBeUndefined(); // Jet Airways, dissolved
  });

  it('still offers a well-formed code that is not in the table', () => {
    expect(searchAirlines('9W')).toEqual([{ iata: '9W', name: 'Airline 9W' }]);
    expect(searchAirlines('99')).toEqual([]);
  });

  it('ignores queries that are too short', () => {
    expect(searchAirlines('d')).toEqual([]);
    expect(searchAirlines(' ')).toEqual([]);
  });
});

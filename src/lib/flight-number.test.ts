import { describe, it, expect } from 'vitest';
import { parseFlightNumber } from './flight-number';

const iata = (code: string) => ({ system: 'iata', code });
const icao = (code: string) => ({ system: 'icao', code });

describe('parseFlightNumber()', () => {
  it('drops leading zeros (boarding passes pad to 4 digits)', () => {
    expect(parseFlightNumber('UA0108')).toEqual(iata('UA108'));
    expect(parseFlightNumber('UA00108')).toEqual(iata('UA108'));
    expect(parseFlightNumber('LH0001')).toEqual(iata('LH1'));
  });

  it('keeps trailing and inner zeros', () => {
    expect(parseFlightNumber('UA1080')).toEqual(iata('UA1080'));
    expect(parseFlightNumber('UA2410')).toEqual(iata('UA2410'));
    expect(parseFlightNumber('UA1008')).toEqual(iata('UA1008'));
    expect(parseFlightNumber('UA100')).toEqual(iata('UA100'));
    expect(parseFlightNumber('UA0100')).toEqual(iata('UA100'));
  });

  it('keeps a lone zero', () => {
    expect(parseFlightNumber('UA0')).toEqual(iata('UA0'));
    expect(parseFlightNumber('UA0000')).toEqual(iata('UA0'));
  });

  it('handles IATA airline codes that contain a digit', () => {
    expect(parseFlightNumber('9W0108')).toEqual(iata('9W108'));
    expect(parseFlightNumber('U20108')).toEqual(iata('U2108'));
    expect(parseFlightNumber('U2108')).toEqual(iata('U2108'));
    expect(parseFlightNumber('B60010')).toEqual(iata('B610'));
  });

  it('keeps an operational suffix letter', () => {
    expect(parseFlightNumber('UA0108A')).toEqual(iata('UA108A'));
    expect(parseFlightNumber('UAL0108A')).toEqual(icao('UAL108A'));
  });

  it('accepts lowercase, spaces and hyphens', () => {
    expect(parseFlightNumber(' ua 0108 ')).toEqual(iata('UA108'));
    expect(parseFlightNumber('UA-0108')).toEqual(iata('UA108'));
    expect(parseFlightNumber('ual 0108')).toEqual(icao('UAL108'));
  });

  it('recognizes ICAO flight numbers (3-letter airline code) with the same zero rules', () => {
    expect(parseFlightNumber('UAL108')).toEqual(icao('UAL108'));
    expect(parseFlightNumber('UAL0108')).toEqual(icao('UAL108'));
    expect(parseFlightNumber('DLH8936')).toEqual(icao('DLH8936'));
    expect(parseFlightNumber('UAL1080')).toEqual(icao('UAL1080'));
    expect(parseFlightNumber('UAL0')).toEqual(icao('UAL0'));
  });

  it('rejects things that are not flight numbers', () => {
    expect(parseFlightNumber('')).toBeNull();
    expect(parseFlightNumber('UA')).toBeNull();
    expect(parseFlightNumber('UAL')).toBeNull();
    expect(parseFlightNumber('UA12345')).toBeNull();
    expect(parseFlightNumber('UA10800')).toBeNull();
    expect(parseFlightNumber('UAL12345')).toBeNull();
    expect(parseFlightNumber('12345')).toBeNull();
    expect(parseFlightNumber('U2L108')).toBeNull();
    expect(parseFlightNumber('UALX108')).toBeNull();
    expect(parseFlightNumber('NOT-A-FLIGHT')).toBeNull();
  });
});

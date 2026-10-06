import { describe, it, expect } from 'vitest';
import { cleanLabel, parseLatLon, validPushKeys } from './validate';

describe('parseLatLon()', () => {
  it('accepts numbers and numeric strings in range', () => {
    expect(parseLatLon(52.52, '13.405')).toEqual({ latitude: 52.52, longitude: 13.405 });
    expect(parseLatLon(-90, 180)).toEqual({ latitude: -90, longitude: 180 });
  });

  it('rejects missing, non-numeric and out-of-range values', () => {
    expect(parseLatLon(null, 10)).toBeNull();
    expect(parseLatLon('', 10)).toBeNull();
    expect(parseLatLon('abc', 10)).toBeNull();
    expect(parseLatLon(95, 10)).toBeNull();
    expect(parseLatLon(10, -181)).toBeNull();
    expect(parseLatLon(Infinity, 0)).toBeNull();
  });
});

describe('cleanLabel()', () => {
  it('trims, caps at 80 characters and drops empty values', () => {
    expect(cleanLabel('  Berlin  ')).toBe('Berlin');
    expect(cleanLabel('x'.repeat(100))).toHaveLength(80);
    expect(cleanLabel('   ')).toBeNull();
    expect(cleanLabel(42)).toBeNull();
  });
});

describe('validPushKeys()', () => {
  const p256dh = Buffer.alloc(65, 4).toString('base64url');
  const auth = Buffer.alloc(16, 7).toString('base64url');

  it('accepts keys of the Push API sizes', () => {
    expect(validPushKeys(p256dh, auth)).toBe(true);
  });

  it('rejects wrong sizes, wrong alphabets and non-strings', () => {
    expect(validPushKeys(p256dh.slice(0, 40), auth)).toBe(false);
    expect(validPushKeys(p256dh, Buffer.alloc(8).toString('base64url'))).toBe(false);
    expect(validPushKeys(`${p256dh}!`, auth)).toBe(false);
    expect(validPushKeys(undefined, auth)).toBe(false);
  });
});

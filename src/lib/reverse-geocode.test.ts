import { describe, it, expect, vi } from 'vitest';
import { reverseGeocode } from './reverse-geocode';

const respond = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('reverseGeocode()', () => {
  it('builds "city, region, country" and skips a region equal to the city', async () => {
    expect(await reverseGeocode(48.1, 11.6, respond({ city: 'Munich', principalSubdivision: 'Bavaria', countryName: 'Germany' }))).toBe('Munich, Bavaria, Germany');
    expect(await reverseGeocode(52.5, 13.4, respond({ city: 'Berlin', principalSubdivision: 'Berlin', countryName: 'Germany' }))).toBe('Berlin, Germany');
  });

  it('returns null on errors or empty answers', async () => {
    expect(await reverseGeocode(0, 0, respond({}, 500))).toBeNull();
    expect(await reverseGeocode(0, 0, respond({}))).toBeNull();
    expect(await reverseGeocode(0, 0, vi.fn(async () => { throw new TypeError('offline'); }) as unknown as typeof fetch)).toBeNull();
  });
});

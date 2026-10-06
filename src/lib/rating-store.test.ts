import { describe, it, expect, beforeEach, vi } from 'vitest';
import { deviceId, dueRating, forgetRating, rememberForRating } from './rating-store';
import type { ClientPrediction } from './types';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});

const SUNSET = 1_790_000_000;
function prediction(sunsetSec: number, token = `token-${sunsetSec}`): ClientPrediction {
  return { qualityScore: 75, day: 'today', timings: { sunset: new Date(sunsetSec * 1000), goldenHour: null }, ratingToken: token };
}

beforeEach(() => store.clear());

describe('rating store', () => {
  it('only offers a rating once the sunset has (nearly) happened', () => {
    rememberForRating(prediction(SUNSET), 'Berlin');
    expect(dueRating(SUNSET - 3600)).toBeNull();
    expect(dueRating(SUNSET + 600)?.label).toBe('Berlin');
  });

  it('drops entries after the 24-hour window', () => {
    rememberForRating(prediction(SUNSET), 'Berlin');
    expect(dueRating(SUNSET + 25 * 3600)).toBeNull();
    expect(dueRating(SUNSET + 600)).toBeNull(); // already pruned
  });

  it('offers the oldest due sunset first and forgets rated ones', () => {
    // Two pending sunsets, two hours apart.
    rememberForRating(prediction(SUNSET + 7200), 'Munich');
    rememberForRating(prediction(SUNSET), 'Berlin');
    const now = SUNSET + 7200 + 600;
    const first = dueRating(now)!;
    expect(first.label).toBe('Berlin');
    forgetRating(first);
    expect(dueRating(now)?.label).toBe('Munich');
  });

  it('keeps one entry per sunset and location, newest view wins', () => {
    rememberForRating(prediction(SUNSET, 'old'), 'Berlin');
    rememberForRating(prediction(SUNSET, 'new'), 'Berlin');
    expect(dueRating(SUNSET + 600)?.token).toBe('new');
  });

  it('ignores predictions without a rating token', () => {
    rememberForRating({ ...prediction(SUNSET), ratingToken: undefined }, 'Berlin');
    expect(dueRating(SUNSET + 600)).toBeNull();
  });

  it('reuses one device id', () => {
    expect(deviceId()).toBe(deviceId());
  });
});

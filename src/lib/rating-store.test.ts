import { describe, it, expect, beforeEach, vi } from 'vitest';
import { deviceId, dueRating, forgetRating, rememberForRating } from './rating-store';
import type { ClientPrediction } from './types';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});

const SUNSET = 1_790_000_000;
function prediction(sunsetSec: number, token = `token-${sunsetSec}`, event: 'sunset' | 'sunrise' = 'sunset'): ClientPrediction {
  return { event, qualityScore: 75, day: 'today', timings: { event: new Date(sunsetSec * 1000), goldenHour: null }, ratingToken: token };
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

  it('keeps a sunrise and a sunset at the same place apart', () => {
    rememberForRating(prediction(SUNSET, 'set'), 'Berlin');
    rememberForRating(prediction(SUNSET + 12 * 3600, 'rise', 'sunrise'), 'Berlin');
    const first = dueRating(SUNSET + 12 * 3600 + 600)!;
    expect(first.event).toBe('sunset');
    forgetRating(first);
    expect(dueRating(SUNSET + 12 * 3600 + 600)?.event).toBe('sunrise');
  });

  it('reads items saved before sunrise mode as sunsets', () => {
    store.set('sunglow:pending-ratings', JSON.stringify([{ token: 'old', label: 'Berlin', sunsetEpochSec: SUNSET, predictedScore: 70 }]));
    expect(dueRating(SUNSET + 600)).toEqual({ token: 'old', label: 'Berlin', event: 'sunset', eventEpochSec: SUNSET, predictedScore: 70 });
  });

  it('reuses one device id', () => {
    expect(deviceId()).toBe(deviceId());
  });
});

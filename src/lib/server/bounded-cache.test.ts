import { describe, it, expect, vi, afterEach } from 'vitest';
import { BoundedCache } from './bounded-cache';

afterEach(() => {
  vi.useRealTimers();
});

describe('BoundedCache', () => {
  it('expires entries after the TTL', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    const cache = new BoundedCache<number>(1000);
    cache.set('a', 1);
    vi.setSystemTime(999);
    expect(cache.get('a')).toBe(1);
    vi.setSystemTime(1000);
    expect(cache.get('a')).toBeUndefined();
  });

  it('lets an entry use its own TTL', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    const cache = new BoundedCache<number>(1000);
    cache.set('short', 1, 100);
    vi.setSystemTime(100);
    expect(cache.get('short')).toBeUndefined();
  });

  it('evicts the oldest entry at the size cap', () => {
    const cache = new BoundedCache<number>(60_000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('treats re-setting a key as the newest entry', () => {
    const cache = new BoundedCache<number>(60_000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10);
    cache.set('c', 3);
    expect(cache.get('a')).toBe(10);
    expect(cache.get('b')).toBeUndefined();
  });
});

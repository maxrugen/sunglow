import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));

let existing: { latitude: number; longitude: number } | undefined;
let upsert: { values: Record<string, unknown>; set: Record<string, unknown> } | null = null;
vi.mock('$lib/server/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => (existing ? [existing] : []) }) }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
          upsert = { values, set };
        },
      }),
    }),
  },
}));

const { POST } = await import('./+server');

function call(body: Record<string, unknown>) {
  const request = new Request('http://localhost/api/push/subscribe', { method: 'POST', body: JSON.stringify(body) });
  return POST({ request } as Parameters<typeof POST>[0]);
}

const base = {
  subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } },
  latitude: 52.52,
  longitude: 13.405,
  label: 'Berlin',
};

beforeEach(() => {
  existing = undefined;
  upsert = null;
});

describe('POST /api/push/subscribe', () => {
  it('defaults old clients to sunset alerts only', async () => {
    expect((await call(base)).status).toBe(200);
    expect(upsert!.values).toMatchObject({ alertSunset: true, alertSunrise: false });
  });

  it('stores the chosen events', async () => {
    await call({ ...base, events: { sunset: false, sunrise: true } });
    expect(upsert!.set).toMatchObject({ alertSunset: false, alertSunrise: true });
  });

  it('keeps dedup dates when re-subscribing at the same place', async () => {
    existing = { latitude: 52.52, longitude: 13.405 };
    await call({ ...base, events: { sunset: true, sunrise: true } });
    expect(upsert!.set).not.toHaveProperty('lastNotifiedDate');
  });

  it('clears dedup dates when the location changes', async () => {
    existing = { latitude: 48.14, longitude: 11.58 };
    await call(base);
    expect(upsert!.set).toMatchObject({ lastNotifiedDate: null, lastSunriseEveningDate: null, lastSunriseMorningDate: null });
  });

  it('rejects turning every event off', async () => {
    expect((await call({ ...base, events: { sunset: false, sunrise: false } })).status).toBe(400);
    expect(upsert).toBeNull();
  });
});

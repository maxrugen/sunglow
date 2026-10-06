import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockEnv } from '#lib/server/test-env.js';

vi.mock('$app/env/private', () => mockEnv({ CRON_SECRET: 'secret' }));
vi.mock('$app/env', () => ({ dev: false }));
vi.mock('#lib/server/db/index.js', () => ({
  db: { select: () => ({ from: async () => [{ id: 1, endpoint: 'https://fcm.googleapis.com/x' }] }) },
}));
const runAlerts = vi.fn();
vi.mock('#lib/server/alerts.js', () => ({ runAlerts }));

const { GET } = await import('./+server');

function call(auth = 'Bearer secret') {
  const url = new URL('http://localhost/api/cron');
  const request = new Request(url, { headers: { authorization: auth } });
  return GET({ request, url } as unknown as Parameters<typeof GET>[0]);
}

beforeEach(() => {
  runAlerts.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/cron', () => {
  it('requires the bearer secret', async () => {
    expect((await call('Bearer wrong')).status).toBe(401);
  });

  it('returns 200 with the summary when everything worked', async () => {
    runAlerts.mockResolvedValue([{ kind: 'sunset', outcome: 'sent' }]);
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ checked: 1, sent: 1, failed: 0 });
  });

  it('returns 500 so the scheduler reports it when an alert failed', async () => {
    runAlerts.mockResolvedValue([{ kind: 'sunrise-morning', outcome: 'predict-failed' }]);
    expect((await call()).status).toBe(500);
  });

  it('logs and counts a subscriber that throws, then still answers', async () => {
    runAlerts.mockRejectedValue(new Error('db down'));
    const res = await call();
    expect(res.status).toBe(500);
    expect((await res.json()).failed).toBe(1);
    expect(console.error).toHaveBeenCalled();
  });
});

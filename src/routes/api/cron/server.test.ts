import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockEnv } from '#lib/server/test-env.js';

vi.mock('$app/env/private', () => mockEnv({ CRON_SECRET: 'secret' }));
vi.mock('$app/env', () => ({ dev: false }));
vi.mock('#lib/server/db/index.js', () => ({
  db: { select: () => ({ from: async () => [{ id: 1, endpoint: 'https://fcm.googleapis.com/x' }] }) },
}));
const runAlerts = vi.fn();
const runFollowUp = vi.fn();
vi.mock('#lib/server/alerts.js', () => ({ runAlerts, runFollowUp, FOLLOW_UP_DELAY_MS: 30 * 60 * 1000 }));

const { GET } = await import('./+server');

function call(auth = 'Bearer secret') {
  const url = new URL('http://localhost/api/cron');
  const request = new Request(url, { headers: { authorization: auth } });
  return GET({ request, url } as unknown as Parameters<typeof GET>[0]);
}

beforeEach(() => {
  runAlerts.mockReset();
  runFollowUp.mockReset();
  runFollowUp.mockResolvedValue(null);
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

  it('sends due rating follow-ups before alerts and counts them', async () => {
    runFollowUp.mockResolvedValue('sent');
    runAlerts.mockResolvedValue([]);
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ followUps: { sent: 1 }, failed: 0 });
    expect(runFollowUp.mock.invocationCallOrder[0]).toBeLessThan(runAlerts.mock.invocationCallOrder[0]);
  });

  it('reports a failed follow-up send, and skips alerts for a pruned subscription', async () => {
    runFollowUp.mockResolvedValueOnce('send-failed');
    runAlerts.mockResolvedValue([]);
    expect((await call()).status).toBe(500);

    runFollowUp.mockResolvedValueOnce('pruned');
    runAlerts.mockClear();
    expect((await call()).status).toBe(200);
    expect(runAlerts).not.toHaveBeenCalled();
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

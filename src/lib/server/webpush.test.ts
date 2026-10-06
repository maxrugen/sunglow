import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockEnv } from '#lib/server/test-env.js';

vi.mock('$app/env/private', () => mockEnv({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' }));

const sendNotification = vi.fn();
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification } }));

const deleted: unknown[] = [];
vi.mock('./db', () => ({
  db: { delete: () => ({ where: async (w: unknown) => void deleted.push(w) }) },
}));

const { isAllowedPushEndpoint, sendPush } = await import('./webpush');

const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'k', auth: 'a' };
const payload = { title: 't', body: 'b' };
const fail = (statusCode?: number, message = 'push failed') => Object.assign(new Error(message), { statusCode });

beforeEach(() => {
  sendNotification.mockReset();
  deleted.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('isAllowedPushEndpoint()', () => {
  it('allows known push services over HTTPS, including subdomains', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
  });

  it('rejects plain HTTP, look-alike hosts, internal addresses and junk', () => {
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.example/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://evilfcm.googleapis.com.attacker.io/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isAllowedPushEndpoint('not a url')).toBe(false);
  });
});

describe('sendPush()', () => {
  it('sends with a TTL, high urgency and a timeout', async () => {
    sendNotification.mockResolvedValue({});
    expect(await sendPush(sub, payload, { ttlSeconds: 3600 })).toBe('sent');
    expect(sendNotification.mock.calls[0][2]).toEqual({ TTL: 3600, urgency: 'high', timeout: 5000 });
  });

  it('prunes subscriptions that can never be delivered to', async () => {
    for (const err of [fail(404), fail(410), fail(400), fail(undefined, 'The subscription p256dh value should be 65 bytes long.')]) {
      sendNotification.mockRejectedValueOnce(err);
      expect(await sendPush(sub, payload)).toBe('pruned');
    }
    expect(deleted).toHaveLength(4);
  });

  it('keeps subscriptions on errors that are not their fault', async () => {
    for (const err of [fail(403), fail(413), fail(500), fail(undefined, 'socket hang up')]) {
      sendNotification.mockRejectedValueOnce(err);
      expect(await sendPush(sub, payload)).toBe('failed');
    }
    expect(deleted).toHaveLength(0);
  });

  it('skips endpoints outside the allowlist without sending', async () => {
    expect(await sendPush({ ...sub, endpoint: 'https://attacker.example/x' }, payload)).toBe('skipped');
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

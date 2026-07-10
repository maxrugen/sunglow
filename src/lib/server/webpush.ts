import { eq } from 'drizzle-orm';
import webpush from 'web-push';
import { env } from '$env/dynamic/private';
import { db } from './db';
import { pushSubscriptions, type PushSubscriptionRow } from './db/schema';

/**
 * A Web Push `endpoint` must belong to a real browser push service. Restricting
 * to these hosts over HTTPS stops a subscriber from pointing the server at an
 * arbitrary/internal URL (blind SSRF). A positive allowlist inherently rejects
 * private/link-local addresses. Extend the list to support more browsers.
 */
export const ALLOWED_PUSH_HOSTS = [
  'fcm.googleapis.com', // Chrome / Edge (FCM)
  'push.services.mozilla.com', // Firefox (autopush)
  'push.apple.com', // Apple / Safari / iOS PWA (endpoints on web.push.apple.com)
  'notify.windows.com', // Windows (WNS)
] as const;

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_PUSH_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

let vapidReady = false;

export function webPushConfigured(): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

function ensureVapid() {
  if (vapidReady) return;
  webpush.setVapidDetails(
    env.VAPID_SUBJECT || 'mailto:sunglow@example.com',
    env.VAPID_PUBLIC_KEY!,
    env.VAPID_PRIVATE_KEY!
  );
  vapidReady = true;
}

/**
 * Send a push to a single stored subscription. On 404/410 the endpoint is gone,
 * so the row is pruned. Returns 'sent' | 'pruned' | 'failed' for the caller's
 * summary. Rejects endpoints that fail the SSRF allowlist.
 */
export async function sendPush(
  sub: Pick<PushSubscriptionRow, 'endpoint' | 'p256dh' | 'auth'>,
  payload: PushPayload
): Promise<'sent' | 'pruned' | 'failed' | 'skipped'> {
  if (!webPushConfigured()) return 'skipped';
  if (!isAllowedPushEndpoint(sub.endpoint)) return 'skipped';
  ensureVapid();

  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    return 'sent';
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint));
      return 'pruned';
    }
    return 'failed';
  }
}

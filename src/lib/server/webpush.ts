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

export type SendOptions = {
  /** Seconds the push service may hold the message for an offline device; after that it's dropped. */
  ttlSeconds?: number;
};

const SEND_TIMEOUT_MS = 5000;

/**
 * Whether a send error means this subscription can never succeed:
 * 404/410 (gone), 400 (the push service rejected it), or keys web-push
 * refuses to encrypt with. 403 (usually our VAPID setup) and 413 (our
 * payload) are not the subscription's fault, so they don't prune.
 */
function isPermanentFailure(e: unknown): boolean {
  const code = (e as { statusCode?: number }).statusCode;
  if (code === 400 || code === 404 || code === 410) return true;
  // web-push's own key/endpoint validation errors (thrown before anything is sent).
  return code === undefined && /^(The subscription|No user auth|You must pass in a subscription)/.test((e as Error)?.message ?? '');
}

/**
 * Send a push to a single stored subscription. Subscriptions that can never be
 * delivered to are pruned. Returns 'sent' | 'pruned' | 'failed' | 'skipped' for
 * the caller's summary. Rejects endpoints that fail the SSRF allowlist.
 */
export async function sendPush(
  sub: Pick<PushSubscriptionRow, 'endpoint' | 'p256dh' | 'auth'>,
  payload: PushPayload,
  options: SendOptions = {}
): Promise<'sent' | 'pruned' | 'failed' | 'skipped'> {
  if (!webPushConfigured()) return 'skipped';
  if (!isAllowedPushEndpoint(sub.endpoint)) return 'skipped';
  ensureVapid();

  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      {
        // Without a TTL the default is 4 weeks: "great sunset tonight" could arrive days later.
        TTL: Math.max(60, Math.round(options.ttlSeconds ?? 6 * 3600)),
        urgency: 'high',
        timeout: SEND_TIMEOUT_MS,
      }
    );
    return 'sent';
  } catch (e) {
    if (isPermanentFailure(e)) {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint));
      return 'pruned';
    }
    console.error('[webpush] send failed', (e as { statusCode?: number }).statusCode ?? (e as Error)?.message);
    return 'failed';
  }
}

import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { pushSubscriptions } from '$lib/server/db/schema';
import { isAllowedPushEndpoint } from '$lib/server/webpush';
import { pushRequestAuthorized } from '$lib/server/push-auth';
import { parseAlertEvents } from '$lib/server/alerts';

export const POST: RequestHandler = async ({ request }) => {
  if (!pushRequestAuthorized(request)) {
    return json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }

  const sub = body?.subscription ?? body;
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  const latitude = Number(body?.latitude);
  const longitude = Number(body?.longitude);
  const label = typeof body?.label === 'string' ? body.label : null;

  if (typeof endpoint !== 'string' || !isAllowedPushEndpoint(endpoint)) {
    return json({ error: 'invalid or disallowed push endpoint' }, { status: 400 });
  }
  if (typeof p256dh !== 'string' || typeof auth !== 'string') {
    return json({ error: 'missing subscription keys' }, { status: 400 });
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return json({ error: 'invalid or missing latitude/longitude' }, { status: 400 });
  }
  const events = parseAlertEvents(body?.events);
  if (!events) {
    return json({ error: 'events must enable sunset and/or sunrise' }, { status: 400 });
  }

  const userAgent = request.headers.get('user-agent');
  const [existing] = await db
    .select({ latitude: pushSubscriptions.latitude, longitude: pushSubscriptions.longitude })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint));
  // A new location may alert today; re-subscribing at the same place must not repeat today's alerts.
  const resetDedup =
    !existing || existing.latitude !== latitude || existing.longitude !== longitude
      ? { lastNotifiedDate: null, lastSunriseEveningDate: null, lastSunriseMorningDate: null }
      : {};

  await db
    .insert(pushSubscriptions)
    .values({ endpoint, p256dh, auth, latitude, longitude, label, userAgent, ...events })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh, auth, latitude, longitude, label, userAgent, ...events, ...resetDedup },
    });

  return json({ ok: true });
};

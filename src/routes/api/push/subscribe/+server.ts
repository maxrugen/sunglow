import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.js';
import { pushSubscriptions } from '#lib/server/db/schema.js';
import { isAllowedPushEndpoint } from '#lib/server/webpush.js';
import { pushRequestAuthorized } from '#lib/server/push-auth.js';
import { parseAlertEvents } from '#lib/server/alerts.js';
import { cleanLabel, parseLatLon, validPushKeys } from '#lib/server/validate.js';

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
  const coords = parseLatLon(body?.latitude, body?.longitude);
  const label = cleanLabel(body?.label);

  if (typeof endpoint !== 'string' || !isAllowedPushEndpoint(endpoint)) {
    return json({ error: 'invalid or disallowed push endpoint' }, { status: 400 });
  }
  if (!validPushKeys(p256dh, auth)) {
    return json({ error: 'missing or malformed subscription keys' }, { status: 400 });
  }
  if (!coords) {
    return json({ error: 'invalid or missing latitude/longitude' }, { status: 400 });
  }
  // ~100 m is plenty for a forecast; no need to keep anyone's exact position.
  const latitude = Math.round(coords.latitude * 1000) / 1000;
  const longitude = Math.round(coords.longitude * 1000) / 1000;
  const events = parseAlertEvents(body?.events);
  if (!events) {
    return json({ error: 'events must enable sunset and/or sunrise' }, { status: 400 });
  }

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
    .values({ endpoint, p256dh, auth, latitude, longitude, label, ...events })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      // userAgent is no longer collected; clear any value stored by older versions.
      set: { p256dh, auth, latitude, longitude, label, userAgent: null, ...events, ...resetDedup },
    });

  return json({ ok: true });
};

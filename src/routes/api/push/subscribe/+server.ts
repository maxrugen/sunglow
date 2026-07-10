import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { pushSubscriptions } from '$lib/server/db/schema';
import { isAllowedPushEndpoint } from '$lib/server/webpush';
import { pushRequestAuthorized } from '$lib/server/push-auth';

export const config = { runtime: 'nodejs20.x' };

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

  const userAgent = request.headers.get('user-agent');

  await db
    .insert(pushSubscriptions)
    .values({ endpoint, p256dh, auth, latitude, longitude, label, userAgent })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      // Re-subscribing updates keys + the location the user wants alerts for,
      // and clears the dedup date so the new location can notify today.
      set: { p256dh, auth, latitude, longitude, label, userAgent, lastNotifiedDate: null },
    });

  return json({ ok: true });
};

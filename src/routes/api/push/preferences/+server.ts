import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.js';
import { pushSubscriptions } from '#lib/server/db/schema.js';
import { pushRequestAuthorized } from '#lib/server/push-auth.js';
import { parseAlertEvents } from '#lib/server/alerts.js';

/**
 * POST { endpoint, events: { sunset, sunrise } } — change which events an existing
 * subscription alerts on, keeping its location and dedup dates.
 */
export const POST: RequestHandler = async ({ request }) => {
  if (!pushRequestAuthorized(request)) {
    return json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { endpoint?: unknown; events?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }

  if (typeof body?.endpoint !== 'string') {
    return json({ error: 'missing endpoint' }, { status: 400 });
  }
  const events = body.events === undefined ? null : parseAlertEvents(body.events);
  if (!events) {
    return json({ error: 'events must enable sunset and/or sunrise' }, { status: 400 });
  }

  const updated = await db
    .update(pushSubscriptions)
    .set(events)
    .where(eq(pushSubscriptions.endpoint, body.endpoint))
    .returning({ id: pushSubscriptions.id });
  if (updated.length === 0) {
    return json({ error: 'subscription not found' }, { status: 404 });
  }
  return json({ ok: true, events });
};

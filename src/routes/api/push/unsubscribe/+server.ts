import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.js';
import { pushSubscriptions } from '#lib/server/db/schema.js';
import { pushRequestAuthorized } from '#lib/server/push-auth.js';

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

  const endpoint = body?.endpoint;
  if (typeof endpoint !== 'string') {
    return json({ error: 'missing endpoint' }, { status: 400 });
  }

  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  return json({ ok: true });
};

import { json } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { db } from '$lib/server/db';
import { pushSubscriptions, type PushSubscriptionRow } from '$lib/server/db/schema';
import { sendPush } from '$lib/server/webpush';
import { predictEvent } from '$lib/server/prediction';
import { runAlerts, type AlertConfig, type AlertDeps, type AlertKind, type AlertOutcome } from '$lib/server/alerts';

export const config = { maxDuration: 60 };

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Subscribers checked in parallel; bounded to stay polite to Open-Meteo. */
const CONCURRENCY = 5;

/**
 * Bearer header matching CRON_SECRET (Vercel Cron sends this automatically).
 * Without a secret the endpoint is only open in local dev.
 */
function cronAuthorized(request: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return dev;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

const deps: AlertDeps<PushSubscriptionRow> = {
  predict: (event, sub) => predictEvent({ latitude: sub.latitude, longitude: sub.longitude, event }),
  async claim(sub, due) {
    const column = pushSubscriptions[due.column];
    const claimed = await db
      .update(pushSubscriptions)
      .set({ [due.column]: due.dayKey })
      .where(and(eq(pushSubscriptions.endpoint, sub.endpoint), sql`${column} is distinct from ${due.dayKey}`))
      .returning({ id: pushSubscriptions.id });
    return claimed.length > 0;
  },
  async release(sub, due) {
    await db
      .update(pushSubscriptions)
      .set({ [due.column]: sub[due.column] })
      .where(and(eq(pushSubscriptions.endpoint, sub.endpoint), eq(pushSubscriptions[due.column], due.dayKey)));
  },
  send: (sub, message) => sendPush(sub, message),
};

async function handle(request: Request, url: URL) {
  if (!cronAuthorized(request)) {
    return json({ error: 'unauthorized' }, { status: 401 });
  }

  const alertConfig: AlertConfig = {
    sunsetLeadHours: num(env.NOTIFY_LEAD_HOURS, 2),
    sunriseLeadHours: num(env.SUNRISE_LEAD_HOURS, 1),
    sunriseEveningHour: num(env.SUNRISE_EVENING_HOUR, 20),
    scoreMin: num(env.SUNSET_SCORE_MIN, 80),
    confidenceMin: num(env.SUNSET_CONFIDENCE_MIN, 70),
  };
  const appUrl = (env.APP_URL || url.origin).replace(/\/$/, '');
  const now = new Date();

  const subs = await db.select().from(pushSubscriptions);
  const outcomes: Record<AlertKind, Partial<Record<AlertOutcome, number>>> = {
    sunset: {},
    'sunrise-evening': {},
    'sunrise-morning': {},
  };
  let failed = 0;

  // A fixed pool of workers drains the shared queue.
  const queue = [...subs];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let sub = queue.shift(); sub; sub = queue.shift()) {
        try {
          for (const { kind, outcome } of await runAlerts(sub, now, alertConfig, appUrl, deps)) {
            outcomes[kind][outcome] = (outcomes[kind][outcome] ?? 0) + 1;
          }
        } catch {
          // A DB error for one subscriber shouldn't abort the whole run.
          failed++;
        }
      }
    })
  );

  const total = (outcome: AlertOutcome) =>
    Object.values(outcomes).reduce((sum, byOutcome) => sum + (byOutcome[outcome] ?? 0), 0);
  return json({
    checked: subs.length,
    sent: total('sent'),
    pruned: total('pruned'),
    failed: failed + total('predict-failed') + total('send-failed'),
    byKind: outcomes,
  });
}

export const GET: RequestHandler = ({ request, url }) => handle(request, url);
export const POST: RequestHandler = ({ request, url }) => handle(request, url);

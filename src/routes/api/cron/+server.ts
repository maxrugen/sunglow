import { json } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import * as env from '$app/env/private';
import { dev } from '$app/env';
import { db } from '#lib/server/db/index.js';
import { pushSubscriptions, type PushSubscriptionRow } from '#lib/server/db/schema.js';
import { sendPush } from '#lib/server/webpush.js';
import { predictEvent } from '#lib/server/prediction.js';
import {
  FOLLOW_UP_DELAY_MS,
  runAlerts,
  runFollowUp,
  type AlertConfig,
  type AlertDeps,
  type AlertKind,
  type AlertOutcome,
  type FollowUpDeps,
  type FollowUpOutcome,
} from '#lib/server/alerts.js';
import { createRatingToken, inRatingWindow, verifyRatingToken } from '#lib/server/ratings.js';

export const config = { maxDuration: 60 };

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Subscribers checked in parallel; bounded to stay polite to Open-Meteo. */
const CONCURRENCY = 5;

/**
 * Bearer header matching CRON_SECRET (sent by the hourly cron-job.org job).
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
  send: (sub, message, options) => sendPush(sub, message, options),
  async scheduleFollowUp(sub, due, payload) {
    const token = createRatingToken(payload);
    if (!token) return; // ratings are off
    await db
      .update(pushSubscriptions)
      .set({ ratingToken: token, ratingFollowupAt: new Date(due.eventTime.getTime() + FOLLOW_UP_DELAY_MS) })
      .where(eq(pushSubscriptions.endpoint, sub.endpoint));
  },
};

const followUpDeps: FollowUpDeps<PushSubscriptionRow> = {
  async claim(sub) {
    const claimed = await db
      .update(pushSubscriptions)
      .set({ ratingToken: null, ratingFollowupAt: null })
      .where(
        // The exact follow-up this run read: not one scheduled since, and not one another run took.
        and(eq(pushSubscriptions.endpoint, sub.endpoint), eq(pushSubscriptions.ratingFollowupAt, sub.ratingFollowupAt!))
      )
      .returning({ id: pushSubscriptions.id });
    return claimed.length > 0;
  },
  async release(sub) {
    // Only if nothing newer was scheduled meanwhile.
    await db
      .update(pushSubscriptions)
      .set({ ratingToken: sub.ratingToken, ratingFollowupAt: sub.ratingFollowupAt })
      .where(and(eq(pushSubscriptions.endpoint, sub.endpoint), sql`${pushSubscriptions.ratingFollowupAt} is null`));
  },
  readToken(token) {
    const snapshot = verifyRatingToken(token);
    return snapshot && inRatingWindow(snapshot.eventEpochSec) ? snapshot : null;
  },
  send: (sub, message, options) => sendPush(sub, message, options),
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
  const followUps: Partial<Record<FollowUpOutcome, number>> = {};
  let failed = 0;

  // A fixed pool of workers drains the shared queue.
  const queue = [...subs];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let sub = queue.shift(); sub; sub = queue.shift()) {
        try {
          // Follow-ups first: an alert for the next event would replace the pending one.
          const followUp = await runFollowUp(sub, now, appUrl, followUpDeps);
          if (followUp) followUps[followUp] = (followUps[followUp] ?? 0) + 1;
          if (followUp === 'pruned') continue;
          for (const { kind, outcome } of await runAlerts(sub, now, alertConfig, appUrl, deps)) {
            outcomes[kind][outcome] = (outcomes[kind][outcome] ?? 0) + 1;
          }
        } catch (err) {
          // A DB error for one subscriber shouldn't abort the whole run.
          console.error('[cron] subscriber failed', sub.id, err);
          failed++;
        }
      }
    })
  );

  const total = (outcome: AlertOutcome) =>
    Object.values(outcomes).reduce((sum, byOutcome) => sum + (byOutcome[outcome] ?? 0), 0);
  const summary = {
    checked: subs.length,
    sent: total('sent'),
    pruned: total('pruned'),
    failed: failed + total('predict-failed') + total('send-failed') + (followUps['send-failed'] ?? 0),
    byKind: outcomes,
    followUps,
  };
  // A non-2xx status makes the scheduler (cron-job.org) report the failed run.
  return json(summary, { status: summary.failed > 0 ? 500 : 200 });
}

export const GET: RequestHandler = ({ request, url }) => handle(request, url);
export const POST: RequestHandler = ({ request, url }) => handle(request, url);

import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import SunCalc from 'suncalc';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { pushSubscriptions } from '$lib/server/db/schema';
import { sendPush } from '$lib/server/webpush';
import { predictSunset } from '$lib/server/prediction';

export const config = { runtime: 'nodejs20.x', maxDuration: 60 };

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Bearer header or ?key= query param, matching CRON_SECRET. Open if unset. */
function cronAuthorized(request: Request, url: URL): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return true;
  if (request.headers.get('authorization') === `Bearer ${secret}`) return true;
  return url.searchParams.get('key') === secret;
}

function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function handle(request: Request, url: URL) {
  if (!cronAuthorized(request, url)) {
    return json({ error: 'unauthorized' }, { status: 401 });
  }

  const scoreMin = num(env.SUNSET_SCORE_MIN, 80);
  const confidenceMin = num(env.SUNSET_CONFIDENCE_MIN, 70);
  const leadHours = num(env.NOTIFY_LEAD_HOURS, 2);
  const appUrl = (env.APP_URL || url.origin).replace(/\/$/, '');

  const now = Date.now();
  const leadWindowStart = leadHours * 3600_000;
  const leadWindowEnd = (leadHours + 1) * 3600_000;

  const subs = await db.select().from(pushSubscriptions);

  let checked = 0;
  let sent = 0;
  let pruned = 0;
  let failed = 0;
  let skipped = 0;

  for (const sub of subs) {
    checked++;
    const sunset = SunCalc.getTimes(new Date(), sub.latitude, sub.longitude).sunset;
    if (!(sunset instanceof Date) || isNaN(sunset.getTime())) {
      skipped++;
      continue;
    }
    const leadMs = sunset.getTime() - now;
    // Only act in the target hour before sunset (matches the hourly scheduler).
    if (leadMs < leadWindowStart || leadMs >= leadWindowEnd) {
      skipped++;
      continue;
    }
    const dayKey = utcDateKey(sunset);
    if (sub.lastNotifiedDate === dayKey) {
      skipped++;
      continue;
    }

    let payload;
    try {
      payload = await predictSunset({ latitude: sub.latitude, longitude: sub.longitude });
    } catch {
      failed++;
      continue;
    }

    if (payload.qualityScore < scoreMin || payload.confidence < confidenceMin) {
      // Mark as handled so we don't re-score this sunset on later ticks today.
      await db
        .update(pushSubscriptions)
        .set({ lastNotifiedDate: dayKey })
        .where(eq(pushSubscriptions.endpoint, sub.endpoint));
      skipped++;
      continue;
    }

    const label = sub.label || 'your location';
    const deepLink =
      `${appUrl}/?lat=${sub.latitude}&lon=${sub.longitude}` +
      `&label=${encodeURIComponent(label)}`;

    const result = await sendPush(sub, {
      title: 'Great sunset tonight 🌅',
      body: `${label}: ${payload.qualityScore}/100 predicted — golden hour is coming up.`,
      url: deepLink,
      tag: 'sunglow-sunset',
    });

    if (result === 'sent') {
      sent++;
      await db
        .update(pushSubscriptions)
        .set({ lastNotifiedDate: dayKey })
        .where(eq(pushSubscriptions.endpoint, sub.endpoint));
    } else if (result === 'pruned') {
      pruned++;
    } else {
      failed++;
    }
  }

  return json({ checked, sent, pruned, failed, skipped });
}

export const GET: RequestHandler = ({ request, url }) => handle(request, url);
export const POST: RequestHandler = ({ request, url }) => handle(request, url);

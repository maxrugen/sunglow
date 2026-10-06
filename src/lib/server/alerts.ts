import { nextEvent, type PredictionPayload } from '#lib/server/prediction.js';
import { timeZoneAt } from '#lib/server/flight-time.js';
import type { PushPayload, SendOptions } from '#lib/server/webpush.js';
import type { PushSubscriptionRow } from '#lib/server/db/schema.js';
import type { RatingSnapshot } from '#lib/server/ratings.js';
import { EVENT_COPY } from '#lib/events.js';
import type { SkyEvent } from '#lib/types.js';

const HOUR_MS = 3600 * 1000;

export type AlertKind = 'sunset' | 'sunrise-evening' | 'sunrise-morning';
export type DedupColumn = 'lastNotifiedDate' | 'lastSunriseEveningDate' | 'lastSunriseMorningDate';

export type AlertConfig = {
  /** Sunset alert window starts this many hours before sunset (1 h wide). */
  sunsetLeadHours: number;
  /** Morning sunrise alert window starts this many hours before sunrise (1 h wide). */
  sunriseLeadHours: number;
  /** Evening-before sunrise alert from this local hour; the 3-hour range survives a missed cron run. */
  sunriseEveningHour: number;
  scoreMin: number;
  confidenceMin: number;
};

export type AlertDue = {
  kind: AlertKind;
  event: SkyEvent;
  column: DedupColumn;
  /** Local date of the event, used as the dedup key. */
  dayKey: string;
  eventTime: Date;
  goldenHour: Date | null;
  timeZone: string;
};

export type AlertSubscription = Pick<
  PushSubscriptionRow,
  | 'endpoint'
  | 'latitude'
  | 'longitude'
  | 'label'
  | 'alertSunset'
  | 'alertSunrise'
  | 'lastNotifiedDate'
  | 'lastSunriseEveningDate'
  | 'lastSunriseMorningDate'
  | 'ratingToken'
  | 'ratingFollowupAt'
>;

function localDateKey(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function localHour(d: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(d));
}

export function localTimeLabel(d: Date | null, timeZone: string): string | null {
  if (!d || isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}

/** Alerts due for a subscriber at `now` that haven't been handled yet. */
export function alertsDue(sub: AlertSubscription, now: Date, config: AlertConfig): AlertDue[] {
  const timeZone = timeZoneAt(sub.latitude, sub.longitude);
  const due: AlertDue[] = [];

  const add = (kind: AlertKind, event: SkyEvent, column: DedupColumn, inWindow: (eventTime: Date) => boolean) => {
    const next = nextEvent(now, sub.latitude, sub.longitude, event);
    if (!next.time || next.time.getTime() <= now.getTime() || !inWindow(next.time)) return;
    const dayKey = localDateKey(next.time, timeZone);
    if (sub[column] === dayKey) return;
    due.push({ kind, event, column, dayKey, eventTime: next.time, goldenHour: next.goldenHour, timeZone });
  };
  const leadWindow = (leadHours: number) => (eventTime: Date) => {
    const lead = eventTime.getTime() - now.getTime();
    return lead >= leadHours * HOUR_MS && lead < (leadHours + 1) * HOUR_MS;
  };

  if (sub.alertSunset) add('sunset', 'sunset', 'lastNotifiedDate', leadWindow(config.sunsetLeadHours));
  if (sub.alertSunrise) {
    const hour = localHour(now, timeZone);
    const evening = hour >= config.sunriseEveningHour && hour < config.sunriseEveningHour + 3;
    // Evening-before: tomorrow's sunrise, at least a few hours out.
    if (evening) add('sunrise-evening', 'sunrise', 'lastSunriseEveningDate', (t) => t.getTime() - now.getTime() >= 3 * HOUR_MS);
    add('sunrise-morning', 'sunrise', 'lastSunriseMorningDate', leadWindow(config.sunriseLeadHours));
  }
  return due;
}

/** Notification text and deep link for a due alert. */
export function alertMessage(due: AlertDue, sub: AlertSubscription, payload: PredictionPayload, appUrl: string): PushPayload {
  const label = sub.label || 'your location';
  const at = localTimeLabel(due.eventTime, due.timeZone);
  const golden = localTimeLabel(due.goldenHour, due.timeZone);
  const score = `${payload.qualityScore}/100`;
  const url =
    `${appUrl}/?lat=${sub.latitude}&lon=${sub.longitude}&label=${encodeURIComponent(label)}` +
    (due.event === 'sunrise' ? '&event=sunrise' : '');

  if (due.kind === 'sunrise-evening') {
    return {
      title: 'Great sunrise tomorrow 🌅',
      body: `${label}: ${score} predicted, sunrise at ${at}${golden ? `, golden hour until ${golden}` : ''}.`,
      url,
      tag: 'sunglow-sunrise',
    };
  }
  if (due.kind === 'sunrise-morning') {
    return { title: 'Sunrise in about an hour 🌄', body: `${label}: ${score} predicted, sunrise at ${at}.`, url, tag: 'sunglow-sunrise' };
  }
  return {
    title: 'Great sunset tonight 🌅',
    body: golden && at ? `${label}: ${score} predicted — golden hour at ${golden}, sunset at ${at}.` : `${label}: ${score} predicted — golden hour is coming up.`,
    url,
    tag: 'sunglow-sunset',
  };
}

export type AlertDeps<S extends AlertSubscription> = {
  predict: (event: SkyEvent, sub: S) => Promise<PredictionPayload>;
  /** Atomically mark the alert as handled; false if another run already did. */
  claim: (sub: S, due: AlertDue) => Promise<boolean>;
  /** Undo a claim after a failed send so the next run retries. */
  release: (sub: S, due: AlertDue) => Promise<void>;
  send: (sub: S, message: PushPayload, options: SendOptions) => Promise<'sent' | 'pruned' | 'failed' | 'skipped'>;
  /** Remember a sent alert's prediction for the "How was it?" follow-up after the event. */
  scheduleFollowUp?: (sub: S, due: AlertDue, payload: PredictionPayload) => Promise<void>;
};

export type AlertOutcome = 'sent' | 'below-threshold' | 'already-claimed' | 'predict-failed' | 'send-failed' | 'pruned';

/**
 * Handle every due alert for one subscriber. Alerts are claimed before
 * sending, so overlapping cron runs can't notify twice; below-threshold
 * forecasts are claimed too, so they aren't re-scored on later runs.
 */
export async function runAlerts<S extends AlertSubscription>(
  sub: S,
  now: Date,
  config: AlertConfig,
  appUrl: string,
  deps: AlertDeps<S>
): Promise<Array<{ kind: AlertKind; outcome: AlertOutcome }>> {
  const results: Array<{ kind: AlertKind; outcome: AlertOutcome }> = [];
  for (const due of alertsDue(sub, now, config)) {
    let payload: PredictionPayload;
    try {
      payload = await deps.predict(due.event, sub);
    } catch (err) {
      console.error('[alerts] prediction failed', due.kind, err);
      results.push({ kind: due.kind, outcome: 'predict-failed' }); // not claimed: retried next run
      continue;
    }
    if (!(await deps.claim(sub, due))) {
      results.push({ kind: due.kind, outcome: 'already-claimed' });
      continue;
    }
    if (payload.qualityScore < config.scoreMin || payload.confidence < config.confidenceMin) {
      results.push({ kind: due.kind, outcome: 'below-threshold' });
      continue;
    }
    // Worthless once the event (and its afterglow) is over, so let undelivered pushes expire.
    const ttlSeconds = (due.eventTime.getTime() - now.getTime()) / 1000 + 30 * 60;
    const result = await deps.send(sub, alertMessage(due, sub, payload, appUrl), { ttlSeconds });
    if (result === 'sent') {
      results.push({ kind: due.kind, outcome: 'sent' });
      try {
        await deps.scheduleFollowUp?.(sub, due, payload);
      } catch (err) {
        // The alert went out; a missing follow-up only costs a rating.
        console.error('[alerts] could not schedule the rating follow-up', err);
      }
    } else if (result === 'pruned') {
      results.push({ kind: due.kind, outcome: 'pruned' });
      break; // the subscription is gone
    } else {
      await deps.release(sub, due);
      results.push({ kind: due.kind, outcome: 'send-failed' });
    }
  }
  return results;
}

/** The follow-up goes out on the first cron run this long after the event (afterglow included). */
export const FOLLOW_UP_DELAY_MS = 30 * 60 * 1000;
/** Undelivered follow-ups are dropped after this long; rating stays possible for 24 h. */
const FOLLOW_UP_TTL_MS = 12 * HOUR_MS;
/** Same as ratings.ts (not imported: alerts.ts stays free of env access). */
const RATING_WINDOW_MS = 24 * HOUR_MS;

/** "How was the sunset?" notification, linking to the rating prompt for that prediction. */
export function followUpMessage(sub: AlertSubscription, snapshot: RatingSnapshot, token: string, appUrl: string): PushPayload {
  const label = sub.label || 'your location';
  const { noun, icon } = EVENT_COPY[snapshot.event];
  return {
    title: `How was the ${noun}? ${icon}`,
    body: `${label}: we predicted ${snapshot.predictedScore}/100. Tap to rate it.`,
    url: `${appUrl}/?rate=${encodeURIComponent(token)}&label=${encodeURIComponent(label)}`,
    // Same tag as the alert, so the follow-up replaces it.
    tag: `sunglow-${snapshot.event}`,
  };
}

export type FollowUpDeps<S extends AlertSubscription> = {
  /** Atomically take the pending follow-up; false if another run already did. */
  claim: (sub: S) => Promise<boolean>;
  /** Put it back after a failed send so the next run retries. */
  release: (sub: S) => Promise<void>;
  /** The token's snapshot, or null if it is invalid or can no longer be rated. */
  readToken: (token: string) => RatingSnapshot | null;
  send: AlertDeps<S>['send'];
};

export type FollowUpOutcome = 'sent' | 'expired' | 'already-claimed' | 'send-failed' | 'pruned';

/** Send a subscriber's pending "How was it?" follow-up once it's due. Null if nothing is due. */
export async function runFollowUp<S extends AlertSubscription>(
  sub: S,
  now: Date,
  appUrl: string,
  deps: FollowUpDeps<S>
): Promise<FollowUpOutcome | null> {
  if (!sub.ratingToken || !sub.ratingFollowupAt || sub.ratingFollowupAt.getTime() > now.getTime()) return null;
  if (!(await deps.claim(sub))) return 'already-claimed';
  const snapshot = deps.readToken(sub.ratingToken);
  if (!snapshot) return 'expired';
  // Never deliver it after the rating window (24 h after the event) has closed.
  const windowLeftMs = snapshot.eventEpochSec * 1000 + RATING_WINDOW_MS - now.getTime();
  const result = await deps.send(sub, followUpMessage(sub, snapshot, sub.ratingToken, appUrl), {
    ttlSeconds: Math.min(FOLLOW_UP_TTL_MS, windowLeftMs) / 1000,
  });
  if (result === 'sent') return 'sent';
  if (result === 'pruned') return 'pruned';
  await deps.release(sub);
  return 'send-failed';
}

/**
 * `{ sunset, sunrise }` from a request body. Missing means sunset only, which
 * matches subscriptions made before sunrise alerts. Null if invalid or if both
 * are off (the client should unsubscribe instead).
 */
export function parseAlertEvents(value: unknown): { alertSunset: boolean; alertSunrise: boolean } | null {
  if (value === undefined || value === null) return { alertSunset: true, alertSunrise: false };
  if (typeof value !== 'object') return null;
  const { sunset, sunrise } = value as { sunset?: unknown; sunrise?: unknown };
  if (typeof sunset !== 'boolean' || typeof sunrise !== 'boolean' || (!sunset && !sunrise)) return null;
  return { alertSunset: sunset, alertSunrise: sunrise };
}

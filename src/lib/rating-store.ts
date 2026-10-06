import type { ClientPrediction, SkyEvent } from '$lib/types';

/** A viewed prediction that can be rated once its sunrise or sunset has happened. */
export type PendingRating = {
  token: string;
  label: string;
  event: SkyEvent;
  eventEpochSec: number;
  predictedScore: number;
};

const PENDING_KEY = 'sunglow:pending-ratings';
const DEVICE_KEY = 'sunglow:device-id';
const MAX_PENDING = 5;
// Keep in sync with the server's window (src/lib/server/ratings.ts).
const EARLY_GRACE_SEC = 15 * 60;
const WINDOW_SEC = 24 * 60 * 60;

function read(): PendingRating[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    // Items saved before sunrise mode had no event and named the time sunsetEpochSec.
    return parsed.map(({ sunsetEpochSec, ...item }) => ({
      ...item,
      event: item.event ?? 'sunset',
      eventEpochSec: item.eventEpochSec ?? sunsetEpochSec,
    }));
  } catch {
    return [];
  }
}

function write(items: PendingRating[]) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(items));
  } catch {
    // storage full or disabled: ratings are best-effort
  }
}

const sameEvent = (a: PendingRating, b: PendingRating) =>
  a.event === b.event && a.eventEpochSec === b.eventEpochSec && a.label === b.label;

/** Remember a prediction so we can ask how it turned out after the sunrise or sunset. */
export function rememberForRating(prediction: ClientPrediction, label: string) {
  const time = prediction.timings.event;
  if (!prediction.ratingToken || !time) return;
  const item: PendingRating = {
    token: prediction.ratingToken,
    label: label || 'your location',
    event: prediction.event,
    eventEpochSec: Math.floor(time.getTime() / 1000),
    predictedScore: prediction.qualityScore,
  };
  // Latest view of the same event wins; keep the newest few.
  write([...read().filter((p) => !sameEvent(p, item)), item].slice(-MAX_PENDING));
}

/** Oldest sunrise/sunset that can be rated now. Drops entries whose window has closed. */
export function dueRating(nowSec = Date.now() / 1000): PendingRating | null {
  const items = read();
  const open = items.filter((p) => nowSec <= p.eventEpochSec + WINDOW_SEC);
  if (open.length !== items.length) write(open);
  return (
    open
      .filter((p) => nowSec >= p.eventEpochSec - EARLY_GRACE_SEC)
      .sort((a, b) => a.eventEpochSec - b.eventEpochSec)[0] ?? null
  );
}

export function forgetRating(item: PendingRating) {
  write(read().filter((p) => !sameEvent(p, item)));
}

/** Random id that lets the server keep one rating per device and event. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

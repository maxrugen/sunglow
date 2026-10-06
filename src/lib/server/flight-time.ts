import tzlookup from '@photostructure/tz-lookup';

const DAY_MS = 24 * 60 * 60 * 1000;
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

/** IANA time zone for a coordinate. airports.json has no zone data, so derive it. */
export function timeZoneAt(lat: number, lon: number): string {
  return tzlookup(lat, lon);
}

/** Offset (ms) of `timeZone` from UTC at the instant `utcMs`. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Convert a wall-clock time in `timeZone` to a UTC epoch (ms). */
export function zonedToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  let utc = naive - zoneOffsetMs(naive, timeZone);
  // A second pass corrects guesses that landed on the other side of a DST switch.
  const offset = zoneOffsetMs(utc, timeZone);
  if (naive - utc !== offset) utc = naive - offset;
  return utc;
}

function parseWallClock(value: string) {
  const m = WALL_CLOCK.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return { y: +y, mo: +mo, d: +d, h: +h, mi: +mi, s: s ? +s : 0 };
}

/**
 * Resolve flight times to UTC. Strings with an explicit offset are absolute.
 * Strings without one are wall-clock times at the respective airport, as printed
 * on a ticket. For a wall-clock arrival, the date is only a hint: the arrival is
 * the first matching local time after departure, which handles overnight flights
 * and date-line crossings (flights are capped below 24h).
 */
export function resolveFlightTimes(
  depTime: string,
  arrTime: string,
  depZone: string,
  arrZone: string
): { depMs: number; arrMs: number } | null {
  let depMs: number;
  if (HAS_OFFSET.test(depTime)) {
    depMs = Date.parse(depTime);
  } else {
    const w = parseWallClock(depTime);
    if (!w) return null;
    depMs = zonedToUtcMs(w.y, w.mo, w.d, w.h, w.mi, w.s, depZone);
  }
  if (!Number.isFinite(depMs)) return null;

  if (HAS_OFFSET.test(arrTime)) {
    const arrMs = Date.parse(arrTime);
    return Number.isFinite(arrMs) ? { depMs, arrMs } : null;
  }

  const w = parseWallClock(arrTime);
  if (!w) return null;
  for (let k = -1; k <= 2; k++) {
    const shifted = new Date(Date.UTC(w.y, w.mo - 1, w.d) + k * DAY_MS);
    const arrMs = zonedToUtcMs(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth() + 1,
      shifted.getUTCDate(),
      w.h,
      w.mi,
      w.s,
      arrZone
    );
    if (arrMs > depMs) return { depMs, arrMs };
  }
  return null;
}

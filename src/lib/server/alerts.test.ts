import { describe, it, expect, vi } from 'vitest';
import SunCalc from 'suncalc';
import { alertsDue, alertMessage, parseAlertEvents, runAlerts, type AlertConfig, type AlertSubscription } from './alerts';
import type { PredictionPayload } from './prediction';

const HOUR = 3600 * 1000;
const config: AlertConfig = { sunsetLeadHours: 2, sunriseLeadHours: 1, sunriseEveningHour: 20, scoreMin: 80, confidenceMin: 70 };

function sub(overrides: Partial<AlertSubscription> = {}): AlertSubscription {
  return {
    endpoint: 'https://fcm.googleapis.com/x',
    latitude: 52.52,
    longitude: 13.405,
    label: 'Berlin',
    alertSunset: true,
    alertSunrise: true,
    lastNotifiedDate: null,
    lastSunriseEveningDate: null,
    lastSunriseMorningDate: null,
    ...overrides,
  };
}

const times = (iso: string, lat = 52.52, lon = 13.405) => SunCalc.getTimes(new Date(iso), lat, lon);
const kinds = (s: AlertSubscription, now: Date) => alertsDue(s, now, config).map((d) => d.kind);

describe('alertsDue()', () => {
  const sunset = times('2026-10-06T12:00:00Z').sunset; // Berlin, ~18:34 local
  const sunrise = times('2026-10-07T12:00:00Z').sunrise; // ~07:18 local

  it('alerts 2–3 h before sunset, keyed by the local date', () => {
    const due = alertsDue(sub(), new Date(sunset.getTime() - 2.5 * HOUR), config);
    expect(due.map((d) => d.kind)).toEqual(['sunset']);
    expect(due[0]).toMatchObject({ column: 'lastNotifiedDate', dayKey: '2026-10-06' });
    expect(kinds(sub(), new Date(sunset.getTime() - 1 * HOUR))).toEqual([]);
  });

  it('alerts 1–2 h before sunrise', () => {
    expect(kinds(sub(), new Date(sunrise.getTime() - 1.5 * HOUR))).toEqual(['sunrise-morning']);
    expect(kinds(sub(), new Date(sunrise.getTime() - 0.5 * HOUR))).toEqual([]);
  });

  it("alerts between 20:00 and 23:00 local the evening before, for tomorrow's sunrise", () => {
    const due = alertsDue(sub({ alertSunset: false }), new Date('2026-10-06T18:30:00Z'), config); // 20:30 CEST
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ kind: 'sunrise-evening', column: 'lastSunriseEveningDate', dayKey: '2026-10-07' });
    expect(due[0].eventTime.toISOString()).toBe(sunrise.toISOString());
    expect(kinds(sub({ alertSunset: false }), new Date('2026-10-06T17:30:00Z'))).toEqual([]); // 19:30
    expect(kinds(sub({ alertSunset: false }), new Date('2026-10-06T21:30:00Z'))).toEqual([]); // 23:30
  });

  it('handles :30 and :45 time zones and the DST change', () => {
    const delhi = sub({ latitude: 28.61, longitude: 77.21, alertSunset: false });
    const kathmandu = sub({ latitude: 27.7, longitude: 85.32, alertSunset: false });
    expect(kinds(delhi, new Date('2026-10-06T15:00:00Z'))).toContain('sunrise-evening'); // 20:30 IST
    expect(kinds(kathmandu, new Date('2026-10-06T15:00:00Z'))).toContain('sunrise-evening'); // 20:45 NPT
    // 25 Oct 2026: Berlin is back on CET (UTC+1), so 19:00Z is 20:00 local.
    expect(kinds(sub({ alertSunset: false }), new Date('2026-10-25T19:00:00Z'))).toContain('sunrise-evening');
  });

  it('finds the next sunrise at high latitude', () => {
    const tromso = { latitude: 69.65, longitude: 18.96 };
    const next = times('2026-05-11T10:00:00Z', tromso.latitude, tromso.longitude).sunrise;
    const s = sub({ ...tromso, alertSunset: false });
    expect(kinds(s, new Date(next.getTime() - 1.5 * HOUR))).toContain('sunrise-morning');
  });

  it('skips handled alerts and disabled events', () => {
    const now = new Date(sunset.getTime() - 2.5 * HOUR);
    expect(kinds(sub({ lastNotifiedDate: '2026-10-06' }), now)).toEqual([]);
    expect(kinds(sub({ alertSunset: false }), now)).toEqual([]);
    expect(kinds(sub({ alertSunrise: false }), new Date(sunrise.getTime() - 1.5 * HOUR))).toEqual([]);
  });
});

describe('alertMessage()', () => {
  it('links sunrise alerts to the sunrise view', () => {
    const due = alertsDue(sub({ alertSunset: false }), new Date('2026-10-06T18:30:00Z'), config)[0];
    const msg = alertMessage(due, sub(), { qualityScore: 88 } as PredictionPayload, 'https://example.app');
    expect(msg.title).toContain('sunrise tomorrow');
    expect(msg.body).toMatch(/^Berlin: 88\/100 predicted, sunrise at 07:\d\d, golden hour until 08:\d\d\.$/);
    expect(msg.url).toContain('&event=sunrise');
    expect(msg.tag).toBe('sunglow-sunrise');
  });
});

describe('runAlerts()', () => {
  const sunrise = times('2026-10-07T12:00:00Z').sunrise;
  const now = new Date(sunrise.getTime() - 1.5 * HOUR);
  const great = { qualityScore: 90, confidence: 85 } as PredictionPayload;

  function fakeDeps(score = great) {
    const claimed = new Set<string>();
    const deps = {
      predict: vi.fn(async () => score),
      claim: vi.fn(async (_s: AlertSubscription, due: { column: string; dayKey: string }) => {
        const key = `${due.column}:${due.dayKey}`;
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      }),
      release: vi.fn(async (_s: AlertSubscription, due: { column: string; dayKey: string }) => {
        claimed.delete(`${due.column}:${due.dayKey}`);
      }),
      send: vi.fn(async () => 'sent' as const),
    };
    return deps;
  }

  it('lets undelivered pushes expire 30 minutes after the event', async () => {
    const deps = fakeDeps();
    await runAlerts(sub({ alertSunset: false }), now, config, 'https://x', deps);
    const options = (deps.send.mock.calls[0] as unknown[])[2] as { ttlSeconds: number };
    expect(options.ttlSeconds).toBeCloseTo(1.5 * 3600 + 30 * 60, 0);
  });

  it('sends once even if two runs overlap', async () => {
    const deps = fakeDeps();
    const s = sub({ alertSunset: false });
    const [a, b] = await Promise.all([runAlerts(s, now, config, 'https://x', deps), runAlerts(s, now, config, 'https://x', deps)]);
    expect([...a, ...b].map((r) => r.outcome).sort()).toEqual(['already-claimed', 'sent']);
    expect(deps.send).toHaveBeenCalledTimes(1);
  });

  it('claims but does not send below the thresholds', async () => {
    const deps = fakeDeps({ qualityScore: 60, confidence: 90 } as PredictionPayload);
    const results = await runAlerts(sub({ alertSunset: false }), now, config, 'https://x', deps);
    expect(results).toEqual([{ kind: 'sunrise-morning', outcome: 'below-threshold' }]);
    expect(deps.claim).toHaveBeenCalledTimes(1);
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('releases the claim when sending fails, so the next run retries', async () => {
    const deps = fakeDeps();
    deps.send.mockResolvedValueOnce('failed' as never);
    const s = sub({ alertSunset: false });
    expect((await runAlerts(s, now, config, 'https://x', deps))[0].outcome).toBe('send-failed');
    expect(deps.release).toHaveBeenCalledTimes(1);
    expect((await runAlerts(s, now, config, 'https://x', deps))[0].outcome).toBe('sent');
  });

  it("doesn't claim when the prediction fails", async () => {
    const deps = fakeDeps();
    deps.predict.mockRejectedValueOnce(new Error('upstream'));
    expect((await runAlerts(sub({ alertSunset: false }), now, config, 'https://x', deps))[0].outcome).toBe('predict-failed');
    expect(deps.claim).not.toHaveBeenCalled();
  });
});

describe('parseAlertEvents()', () => {
  it('defaults to sunset only and rejects invalid or empty choices', () => {
    expect(parseAlertEvents(undefined)).toEqual({ alertSunset: true, alertSunrise: false });
    expect(parseAlertEvents({ sunset: false, sunrise: true })).toEqual({ alertSunset: false, alertSunrise: true });
    expect(parseAlertEvents({ sunset: false, sunrise: false })).toBeNull();
    expect(parseAlertEvents({ sunset: 'yes', sunrise: true })).toBeNull();
    expect(parseAlertEvents('sunrise')).toBeNull();
  });
});

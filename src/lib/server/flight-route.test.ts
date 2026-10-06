import { describe, it, expect } from 'vitest';
import {
  bearing,
  interpolateGreatCircle,
  findEventWindows,
  computeSunSide,
  bestWaypointPerSighting,
} from './flight-route';
import type { EventWaypoint } from '$lib/types';

describe('bearing()', () => {
  it('returns ~0° for due north', () => {
    const b = bearing(0, 0, 10, 0);
    expect(b).toBeCloseTo(0, 0);
  });

  it('returns ~90° for due east', () => {
    const b = bearing(0, 0, 0, 10);
    expect(b).toBeCloseTo(90, 0);
  });

  it('returns ~180° for due south', () => {
    const b = bearing(10, 0, 0, 0);
    expect(b).toBeCloseTo(180, 0);
  });

  it('returns ~270° for due west', () => {
    const b = bearing(0, 10, 0, 0);
    expect(b).toBeCloseTo(270, 0);
  });

  it('handles identical points without NaN', () => {
    const b = bearing(51.5, -0.1, 51.5, -0.1);
    expect(Number.isNaN(b)).toBe(false);
  });

  it('JFK→LAX is roughly westward (250–280°)', () => {
    const b = bearing(40.64, -73.78, 33.94, -118.41);
    expect(b).toBeGreaterThan(250);
    expect(b).toBeLessThan(280);
  });
});

describe('interpolateGreatCircle()', () => {
  const depLat = 48.35, depLon = 11.79; // MUC
  const arrLat = 51.13, arrLon = 13.77; // DRS
  const depTime = Date.parse('2026-04-12T17:00:00Z');
  const arrTime = Date.parse('2026-04-12T18:00:00Z'); // 1-hour flight

  it('returns at least 2 waypoints', () => {
    const wps = interpolateGreatCircle(depLat, depLon, arrLat, arrLon, depTime, arrTime, 15);
    expect(wps.length).toBeGreaterThanOrEqual(2);
  });

  it('first waypoint matches departure', () => {
    const wps = interpolateGreatCircle(depLat, depLon, arrLat, arrLon, depTime, arrTime, 15);
    expect(wps[0].lat).toBeCloseTo(depLat, 2);
    expect(wps[0].lon).toBeCloseTo(depLon, 2);
    expect(wps[0].time).toBe(depTime);
  });

  it('last waypoint matches arrival', () => {
    const wps = interpolateGreatCircle(depLat, depLon, arrLat, arrLon, depTime, arrTime, 15);
    const last = wps[wps.length - 1];
    expect(last.lat).toBeCloseTo(arrLat, 2);
    expect(last.lon).toBeCloseTo(arrLon, 2);
    expect(last.time).toBe(arrTime);
  });

  it('waypoint times are monotonically increasing', () => {
    const wps = interpolateGreatCircle(depLat, depLon, arrLat, arrLon, depTime, arrTime, 15);
    for (let i = 1; i < wps.length; i++) {
      expect(wps[i].time).toBeGreaterThan(wps[i - 1].time);
    }
  });

  it('handles very short flights (< 15 min) with at least 2 points', () => {
    const short = interpolateGreatCircle(depLat, depLon, arrLat, arrLon, depTime, depTime + 5 * 60_000, 15);
    expect(short.length).toBeGreaterThanOrEqual(2);
  });

  it('handles coincident departure and arrival', () => {
    const wps = interpolateGreatCircle(depLat, depLon, depLat, depLon, depTime, arrTime, 15);
    wps.forEach(wp => {
      expect(wp.lat).toBeCloseTo(depLat, 5);
      expect(wp.lon).toBeCloseTo(depLon, 5);
    });
  });

  it('long-haul produces many waypoints', () => {
    const jfkDep = Date.parse('2026-04-12T12:00:00Z');
    const lhrArr = Date.parse('2026-04-12T20:00:00Z');
    const wps = interpolateGreatCircle(40.64, -73.78, 51.47, -0.46, jfkDep, lhrArr, 15);
    expect(wps.length).toBeGreaterThan(30);
  });
});

describe('findEventWindows()', () => {
  it('finds nothing for a mid-morning flight', () => {
    // MUC→DRS 06:00–09:00Z in April: sunrise (~04:30Z) is well before departure.
    const depTime = Date.parse('2026-04-12T06:00:00Z');
    const arrTime = Date.parse('2026-04-12T09:00:00Z');
    const wps = interpolateGreatCircle(48.35, 11.79, 51.13, 13.77, depTime, arrTime, 15);
    expect(findEventWindows(wps, 60)).toEqual([]);
  });

  it('returns sunset waypoints for an evening flight', () => {
    // MUC→DRS around local sunset in April (approx 18:00 UTC)
    const depTime = Date.parse('2026-04-12T17:30:00Z');
    const arrTime = Date.parse('2026-04-12T19:30:00Z');
    const wps = interpolateGreatCircle(48.35, 11.79, 51.13, 13.77, depTime, arrTime, 15);
    const windows = findEventWindows(wps, 60);
    expect(windows.length).toBeGreaterThan(0);
    windows.forEach((w) => {
      expect(w.event).toBe('sunset');
      expect(w.offsetMinutes).toBeLessThanOrEqual(60);
      expect(w.sunAzimuth).toBeGreaterThanOrEqual(0);
      expect(w.sunAzimuth).toBeLessThan(360);
      expect(w.planeHeading).toBeGreaterThanOrEqual(0);
      expect(w.planeHeading).toBeLessThan(360);
      expect(new Date(w.eventTime).getUTCFullYear()).toBe(2026);
    });
  });

  it('finds the sunrise on an overnight JFK→LHR flight', () => {
    // Departs 22:30Z (18:30 EDT), lands 05:30Z (06:30 BST).
    const depTime = Date.parse('2026-06-10T22:30:00Z');
    const arrTime = Date.parse('2026-06-11T05:30:00Z');
    const wps = interpolateGreatCircle(40.64, -73.78, 51.47, -0.45, depTime, arrTime, 15);
    const sightings = bestWaypointPerSighting(findEventWindows(wps, 60));
    const sunrise = sightings.find((s) => s.event === 'sunrise');
    expect(sunrise).toBeDefined();
    // Eastbound into the sunrise: the sun is in the east-north-east.
    expect(sunrise!.sunAzimuth).toBeGreaterThan(30);
    expect(sunrise!.sunAzimuth).toBeLessThan(90);
  });
});

describe('computeSunSide()', () => {
  it('sun to the right when ahead-right of heading', () => {
    // Plane heading north (0°), sun at 90° (east) → right
    expect(computeSunSide(0, 90)).toBe('right');
  });

  it('sun to the left when behind-left of heading', () => {
    // Plane heading north (0°), sun at 270° (west) → left
    expect(computeSunSide(0, 270)).toBe('left');
  });

  it('either side when the sun is roughly ahead or behind', () => {
    expect(computeSunSide(45, 45)).toBe('either');
    expect(computeSunSide(0, 15)).toBe('either');
    expect(computeSunSide(0, 350)).toBe('either');
    expect(computeSunSide(45, 225)).toBe('either');
    expect(computeSunSide(0, 165)).toBe('either');
  });

  it('picks a side just outside the ±20° band', () => {
    expect(computeSunSide(0, 160)).toBe('right');
    expect(computeSunSide(0, 200)).toBe('left');
  });

  it('JFK→LAX (westbound ~265°) at sunset (~290° azimuth) is right', () => {
    expect(computeSunSide(265, 290)).toBe('right');
  });

  it('LAX→JFK (eastbound ~85°) at sunset (~290° azimuth) is left', () => {
    // relative = (290 - 85 + 360) % 360 = 205 > 180 → left
    expect(computeSunSide(85, 290)).toBe('left');
  });

  it('handles wrap-around: heading 350°, sun at 10°', () => {
    // relative = 20° → just outside the ahead band → right
    expect(computeSunSide(350, 10)).toBe('right');
  });
});

describe('bestWaypointPerSighting()', () => {
  const MIN = 60 * 1000;
  const wp = (event: 'sunrise' | 'sunset', minutes: number, offsetMinutes: number): EventWaypoint => ({
    lat: 50, lon: 10, time: minutes * MIN, event, eventTime: minutes * MIN, offsetMinutes, sunAzimuth: 280, planeHeading: 45,
  });

  it('returns nothing for no windows', () => {
    expect(bestWaypointPerSighting([])).toEqual([]);
  });

  it('keeps the waypoint closest to the event in each group', () => {
    const best = bestWaypointPerSighting([wp('sunset', 0, 30), wp('sunset', 15, 5), wp('sunset', 30, 20)]);
    expect(best).toHaveLength(1);
    expect(best[0].offsetMinutes).toBe(5);
  });

  it('splits two sunsets on a very long flight into two sightings', () => {
    const best = bestWaypointPerSighting([
      wp('sunset', 0, 10), wp('sunset', 15, 3),
      wp('sunset', 20 * 60, 8), wp('sunset', 20 * 60 + 15, 2),
    ]);
    expect(best.map((b) => b.offsetMinutes)).toEqual([3, 2]);
  });

  it('returns sunrise and sunset sightings in time order', () => {
    const best = bestWaypointPerSighting([wp('sunset', 0, 4), wp('sunrise', 9 * 60, 6)]);
    expect(best.map((b) => b.event)).toEqual(['sunset', 'sunrise']);
  });
});

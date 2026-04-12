import { describe, it, expect } from 'vitest';
import {
  bearing,
  interpolateGreatCircle,
  findSunsetWindows,
  computeSunSide,
  bestSunsetWaypoint,
} from './flight-route';
import type { SunsetWaypoint } from '$lib/types';

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

describe('findSunsetWindows()', () => {
  it('returns empty for a morning flight', () => {
    const depTime = Date.parse('2026-04-12T06:00:00Z');
    const arrTime = Date.parse('2026-04-12T09:00:00Z');
    const wps = interpolateGreatCircle(48.35, 11.79, 51.13, 13.77, depTime, arrTime, 15);
    const windows = findSunsetWindows(wps, 60);
    expect(windows.length).toBe(0);
  });

  it('returns waypoints for an evening flight around sunset', () => {
    // MUC→DRS around local sunset in April (approx 18:00 UTC)
    const depTime = Date.parse('2026-04-12T17:30:00Z');
    const arrTime = Date.parse('2026-04-12T19:30:00Z');
    const wps = interpolateGreatCircle(48.35, 11.79, 51.13, 13.77, depTime, arrTime, 15);
    const windows = findSunsetWindows(wps, 60);
    expect(windows.length).toBeGreaterThan(0);
    windows.forEach(sw => {
      expect(sw.offsetMinutes).toBeLessThanOrEqual(60);
      expect(sw.sunAzimuth).toBeGreaterThanOrEqual(0);
      expect(sw.sunAzimuth).toBeLessThan(360);
      expect(sw.planeHeading).toBeGreaterThanOrEqual(0);
      expect(sw.planeHeading).toBeLessThan(360);
    });
  });

  it('sunset waypoints have valid sunsetTime', () => {
    const depTime = Date.parse('2026-04-12T17:30:00Z');
    const arrTime = Date.parse('2026-04-12T19:30:00Z');
    const wps = interpolateGreatCircle(48.35, 11.79, 51.13, 13.77, depTime, arrTime, 15);
    const windows = findSunsetWindows(wps, 60);
    windows.forEach(sw => {
      expect(sw.sunsetTime).toBeGreaterThan(0);
      expect(new Date(sw.sunsetTime).getFullYear()).toBe(2026);
    });
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

  it('sun directly ahead is right (edge case)', () => {
    expect(computeSunSide(45, 45)).toBe('right');
  });

  it('sun directly behind is right when relative=180', () => {
    // relative = (225 - 45 + 360) % 360 = 180 → not > 180 → right
    expect(computeSunSide(45, 225)).toBe('right');
  });

  it('JFK→LAX (westbound ~265°) at sunset (~290° azimuth) is right', () => {
    // Sun slightly right of heading
    expect(computeSunSide(265, 290)).toBe('right');
  });

  it('LAX→JFK (eastbound ~85°) at sunset (~290° azimuth) is left', () => {
    // relative = (290 - 85 + 360) % 360 = 205 > 180 → left
    expect(computeSunSide(85, 290)).toBe('left');
  });

  it('handles wrap-around: heading 350°, sun at 10°', () => {
    // relative = (10 - 350 + 360) % 360 = 20 → right
    expect(computeSunSide(350, 10)).toBe('right');
  });
});

describe('bestSunsetWaypoint()', () => {
  it('returns null for empty array', () => {
    expect(bestSunsetWaypoint([])).toBeNull();
  });

  it('returns the waypoint closest to sunset', () => {
    const wps: SunsetWaypoint[] = [
      { lat: 50, lon: 10, time: 1000, sunsetTime: 1500, offsetMinutes: 30, sunAzimuth: 280, planeHeading: 45 },
      { lat: 51, lon: 11, time: 1100, sunsetTime: 1500, offsetMinutes: 5, sunAzimuth: 281, planeHeading: 46 },
      { lat: 52, lon: 12, time: 1200, sunsetTime: 1500, offsetMinutes: 20, sunAzimuth: 282, planeHeading: 47 },
    ];
    const best = bestSunsetWaypoint(wps);
    expect(best?.offsetMinutes).toBe(5);
    expect(best?.lat).toBe(51);
  });
});

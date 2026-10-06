import SunCalc from 'suncalc';
import type { EventWaypoint, FlightWaypoint, SeatSide, SkyEvent } from '$lib/types';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Compute the great-circle bearing from point A to point B (in degrees, 0=north, clockwise).
 */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = lat1 * DEG_TO_RAD;
  const φ2 = lat2 * DEG_TO_RAD;
  const Δλ = (lon2 - lon1) * DEG_TO_RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * RAD_TO_DEG) + 360) % 360;
}

/**
 * Interpolate waypoints along the great-circle route between departure and arrival.
 * Returns an array of {lat, lon, time} points spaced by `intervalMinutes`.
 */
export function interpolateGreatCircle(
  depLat: number,
  depLon: number,
  arrLat: number,
  arrLon: number,
  depTimeMs: number,
  arrTimeMs: number,
  intervalMinutes: number = 15
): FlightWaypoint[] {
  const φ1 = depLat * DEG_TO_RAD;
  const λ1 = depLon * DEG_TO_RAD;
  const φ2 = arrLat * DEG_TO_RAD;
  const λ2 = arrLon * DEG_TO_RAD;

  // Angular distance using Haversine
  const Δφ = φ2 - φ1;
  const Δλ = λ2 - λ1;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const d = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const duration = arrTimeMs - depTimeMs;
  const intervalMs = intervalMinutes * 60 * 1000;
  const numPoints = Math.max(2, Math.floor(duration / intervalMs) + 1);

  const waypoints: FlightWaypoint[] = [];
  const sinD = Math.sin(d);

  for (let i = 0; i < numPoints; i++) {
    const fraction = i / (numPoints - 1);

    // Great-circle interpolation (Slerp)
    let lat: number, lon: number;
    if (d < 1e-10) {
      // coincident points
      lat = depLat;
      lon = depLon;
    } else {
      const A = Math.sin((1 - fraction) * d) / sinD;
      const B = Math.sin(fraction * d) / sinD;
      const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
      const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
      const z = A * Math.sin(φ1) + B * Math.sin(φ2);
      lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * RAD_TO_DEG;
      lon = Math.atan2(y, x) * RAD_TO_DEG;
    }

    waypoints.push({
      lat,
      lon,
      time: depTimeMs + fraction * duration
    });
  }

  return waypoints;
}

const EVENTS: SkyEvent[] = ['sunrise', 'sunset'];

/**
 * For each waypoint, compute the local sunrise and sunset and keep the
 * waypoints where the plane is within `windowMinutes` of one of them.
 * SunCalc works with absolute time and longitude, so the date line needs no
 * special handling.
 */
export function findEventWindows(waypoints: FlightWaypoint[], windowMinutes: number = 60): EventWaypoint[] {
  const results: EventWaypoint[] = [];

  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    let sunTimes;
    try {
      sunTimes = SunCalc.getTimes(new Date(wp.time), wp.lat, wp.lon);
    } catch {
      continue; // SunCalc can fail for extreme latitudes (polar night/day)
    }

    for (const event of EVENTS) {
      const time: Date | undefined = sunTimes?.[event];
      if (!time || isNaN(time.getTime())) continue;
      const offsetMinutes = Math.abs(wp.time - time.getTime()) / (60 * 1000);
      if (offsetMinutes > windowMinutes) continue;

      // SunCalc azimuth: 0 = south, negative = east, positive = west → compass bearing
      const sunPos = SunCalc.getPosition(time, wp.lat, wp.lon);
      const sunAzimuth = ((sunPos.azimuth * RAD_TO_DEG) + 180 + 360) % 360;

      // Plane heading: bearing to the next waypoint, or from the previous one
      let planeHeading = 0;
      if (i < waypoints.length - 1) {
        planeHeading = bearing(wp.lat, wp.lon, waypoints[i + 1].lat, waypoints[i + 1].lon);
      } else if (i > 0) {
        planeHeading = bearing(waypoints[i - 1].lat, waypoints[i - 1].lon, wp.lat, wp.lon);
      }

      results.push({
        ...wp,
        event,
        eventTime: time.getTime(),
        offsetMinutes: Math.round(offsetMinutes),
        sunAzimuth: Math.round(sunAzimuth),
        planeHeading: Math.round(planeHeading),
      });
    }
  }

  return results;
}

/** Sun within this many degrees of the nose or tail: both windows see it about equally. */
const ALONG_TRACK_DEG = 20;

/**
 * Which side of the plane faces the sun. The relative angle is
 * (sunAzimuth - planeHeading + 360) % 360: 0–180° is right, 180–360° is left,
 * and near 0° or 180° the sun is ahead of or behind the plane.
 */
export function computeSunSide(planeHeading: number, sunAzimuth: number): SeatSide {
  const relative = ((sunAzimuth - planeHeading) % 360 + 360) % 360;
  if (relative < ALONG_TRACK_DEG || relative > 360 - ALONG_TRACK_DEG || Math.abs(relative - 180) < ALONG_TRACK_DEG) {
    return 'either';
  }
  return relative > 180 ? 'left' : 'right';
}

/** Waypoints more than this far apart (in flight time) belong to different sightings. */
const SIGHTING_GAP_MS = 45 * 60 * 1000;

/**
 * One waypoint per sighting: consecutive matching waypoints of the same event
 * form a group (so a 24 h flight with two sunsets yields two), and each group
 * keeps the waypoint closest to its local event. Sorted by time.
 */
export function bestWaypointPerSighting(windows: EventWaypoint[]): EventWaypoint[] {
  const best: EventWaypoint[] = [];
  for (const event of EVENTS) {
    const ofEvent = windows.filter((w) => w.event === event).sort((a, b) => a.time - b.time);
    let group: EventWaypoint[] = [];
    const flush = () => {
      if (group.length) best.push(group.reduce((b, w) => (w.offsetMinutes < b.offsetMinutes ? w : b)));
      group = [];
    };
    for (const w of ofEvent) {
      if (group.length && w.time - group[group.length - 1].time > SIGHTING_GAP_MS) flush();
      group.push(w);
    }
    flush();
  }
  return best.sort((a, b) => a.time - b.time);
}

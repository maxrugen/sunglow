import SunCalc from 'suncalc';
import type { FlightWaypoint, SunsetWaypoint } from '$lib/types';

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

/**
 * For each waypoint, compute the local sunset time and determine if the
 * plane is near the point around sunset. Returns waypoints where the
 * plane is within `windowMinutes` of local sunset.
 */
export function findSunsetWindows(
  waypoints: FlightWaypoint[],
  windowMinutes: number = 60
): SunsetWaypoint[] {
  const results: SunsetWaypoint[] = [];

  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const wpDate = new Date(wp.time);

    try {
      const sunTimes = SunCalc.getTimes(wpDate, wp.lat, wp.lon);
      if (!sunTimes?.sunset || isNaN(sunTimes.sunset.getTime())) continue;

      const sunsetMs = sunTimes.sunset.getTime();
      const offsetMs = Math.abs(wp.time - sunsetMs);
      const offsetMinutes = offsetMs / (60 * 1000);

      if (offsetMinutes <= windowMinutes) {
        // Compute sun position at sunset time at this location
        const sunPos = SunCalc.getPosition(sunTimes.sunset, wp.lat, wp.lon);
        // SunCalc azimuth: 0 = south, negative = east, positive = west
        // Convert to compass bearing: 0 = north, clockwise
        const sunAzimuth = ((sunPos.azimuth * RAD_TO_DEG) + 180) % 360;

        // Compute plane heading (bearing to next waypoint, or from previous)
        let planeHeading: number;
        if (i < waypoints.length - 1) {
          planeHeading = bearing(wp.lat, wp.lon, waypoints[i + 1].lat, waypoints[i + 1].lon);
        } else if (i > 0) {
          planeHeading = bearing(waypoints[i - 1].lat, waypoints[i - 1].lon, wp.lat, wp.lon);
        } else {
          planeHeading = 0;
        }

        results.push({
          ...wp,
          sunsetTime: sunsetMs,
          offsetMinutes: Math.round(offsetMinutes),
          sunAzimuth: Math.round(sunAzimuth),
          planeHeading: Math.round(planeHeading)
        });
      }
    } catch {
      // SunCalc can fail for extreme latitudes (polar night/day)
      continue;
    }
  }

  return results;
}

/**
 * Determine which side of the plane faces the sun at sunset.
 * Returns 'left' or 'right'.
 *
 * The relative angle is computed as: (sunAzimuth - planeHeading + 360) % 360.
 * 0-180° = sun is to the right; 180-360° = sun is to the left.
 */
export function computeSunSide(planeHeading: number, sunAzimuth: number): 'left' | 'right' {
  const relative = ((sunAzimuth - planeHeading) + 360) % 360;
  return relative > 180 ? 'left' : 'right';
}

/**
 * Pick the best sunset waypoint: the one closest in time to local sunset.
 */
export function bestSunsetWaypoint(waypoints: SunsetWaypoint[]): SunsetWaypoint | null {
  if (waypoints.length === 0) return null;
  return waypoints.reduce((best, wp) =>
    wp.offsetMinutes < best.offsetMinutes ? wp : best
  );
}

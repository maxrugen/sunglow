import type { WeatherData } from './server/scoring';

export type { WeatherData };

/** Fields of the server prediction payload that the UI needs. */
export type PredictionSummary = {
  qualityScore: number;
  confidence?: number;
  explanation?: { factors?: Record<string, unknown> };
  day?: 'today' | 'tomorrow';
  timings?: { sunsetEpochSec: number | null; goldenHourEpochSec: number | null };
  used?: { epochSec?: number; latitude?: number; longitude?: number; utcOffsetSeconds?: number };
};

export type ClientPrediction = {
  qualityScore: number;
  confidence?: number;
  explanation?: { factors?: Record<string, unknown> };
  day: 'today' | 'tomorrow';
  timings: { sunset: Date | null; goldenHour: Date | null };
  used?: { epochSec?: number; latitude?: number; longitude?: number; utcOffsetSeconds?: number };
};

export function toClientPrediction(p: PredictionSummary): ClientPrediction {
  const toDate = (sec: number | null | undefined) => (sec != null ? new Date(sec * 1000) : null);
  return {
    qualityScore: p.qualityScore ?? 0,
    confidence: p.confidence,
    explanation: p.explanation,
    day: p.day ?? 'today',
    timings: { sunset: toDate(p.timings?.sunsetEpochSec), goldenHour: toDate(p.timings?.goldenHourEpochSec) },
    used: p.used,
  };
}

// Flight sunset prediction types

export type Airport = {
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
};

export type FlightWaypoint = {
  lat: number;
  lon: number;
  /** Unix timestamp (ms) when the plane is at this point */
  time: number;
};

export type SunsetWaypoint = FlightWaypoint & {
  /** Local sunset time (ms) at this waypoint's position */
  sunsetTime: number;
  /** Minutes between the plane being at this point and local sunset */
  offsetMinutes: number;
  /** Sun azimuth in degrees at sunset */
  sunAzimuth: number;
  /** Plane heading in degrees at this waypoint */
  planeHeading: number;
};

export type FlightPredictionResponse = {
  sunsetDuringFlight: boolean;
  /** Overall sunset quality score (0-100), only present if sunset occurs */
  qualityScore?: number;
  confidence?: number;
  explanation?: { factors?: Record<string, unknown> };
  /** Which side of the plane to sit on: 'left' | 'right' */
  seatSide?: 'left' | 'right';
  /** Human-readable seat recommendation */
  seatRecommendation?: string;
  /** The best sunset waypoint along the route */
  sunsetWaypoint?: SunsetWaypoint;
  /** UTC time string of sunset during flight */
  sunsetTimeUTC?: string;
  /** Description of where sunset occurs (lat/lon label) */
  sunsetLocation?: string;
  /** All sunset waypoints; only the best one carries a score */
  scoredWaypoints?: Array<SunsetWaypoint & { score?: number }>;
  /** Message when no sunset is expected */
  message?: string;
  /** Flight route summary */
  route?: {
    departure: { iata: string; name: string; lat: number; lon: number };
    arrival: { iata: string; name: string; lat: number; lon: number };
    departureTime: string;
    arrivalTime: string;
  };
};



import type { WeatherData } from './server/scoring';

export type { WeatherData };

export type SkyEvent = 'sunset' | 'sunrise';

/** Fields of the server prediction payload that the UI needs. */
export type PredictionSummary = {
  event?: SkyEvent;
  qualityScore: number;
  confidence?: number;
  explanation?: { factors?: Record<string, unknown> };
  day?: 'today' | 'tomorrow';
  timings?: { eventEpochSec: number | null; goldenHourEpochSec: number | null };
  used?: { epochSec?: number; latitude?: number; longitude?: number; utcOffsetSeconds?: number };
  /** Signed snapshot for a later "How was it?" rating; absent when ratings are off. */
  ratingToken?: string;
};

export type ClientPrediction = {
  event: SkyEvent;
  qualityScore: number;
  confidence?: number;
  explanation?: { factors?: Record<string, unknown> };
  day: 'today' | 'tomorrow';
  /** Time of the sunrise/sunset and the related golden-hour boundary. */
  timings: { event: Date | null; goldenHour: Date | null };
  used?: { epochSec?: number; latitude?: number; longitude?: number; utcOffsetSeconds?: number };
  ratingToken?: string;
};

export function toClientPrediction(p: PredictionSummary): ClientPrediction {
  const toDate = (sec: number | null | undefined) => (sec != null ? new Date(sec * 1000) : null);
  return {
    event: p.event ?? 'sunset',
    qualityScore: p.qualityScore ?? 0,
    confidence: p.confidence,
    explanation: p.explanation,
    day: p.day ?? 'today',
    timings: {
      event: toDate(p.timings?.eventEpochSec),
      goldenHour: toDate(p.timings?.goldenHourEpochSec),
    },
    used: p.used,
    ratingToken: p.ratingToken,
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

export type EventWaypoint = FlightWaypoint & {
  event: SkyEvent;
  /** Local sunrise/sunset time (ms) at this waypoint's position */
  eventTime: number;
  /** Minutes between the plane being at this point and the local event */
  offsetMinutes: number;
  /** Sun azimuth in degrees at the event */
  sunAzimuth: number;
  /** Plane heading in degrees at this waypoint */
  planeHeading: number;
};

/** Which window faces the sun; 'either' when it's roughly ahead of or behind the plane. */
export type SeatSide = 'left' | 'right' | 'either';

/** One sunrise or sunset seen from the plane. */
export type FlightSighting = {
  event: SkyEvent;
  /** Quality score (0-100); absent when no forecast covers the date yet */
  qualityScore?: number;
  confidence?: number;
  explanation?: { factors?: Record<string, unknown> };
  seatSide: SeatSide;
  seatRecommendation: string;
  /** UTC time of the event at the best waypoint */
  timeUTC: string;
  /** IANA time zone at the plane's position, for showing the local time */
  timeZone?: string;
  /** Where the plane is at the time (lat/lon label) */
  location: string;
  waypoint: EventWaypoint;
};

export type FlightPredictionResponse = {
  /** Sunrises and sunsets during the flight, in time order */
  sightings: FlightSighting[];
  /** Message when there are none */
  message?: string;
  /** Flight route summary */
  route?: {
    departure: { iata: string; name: string; lat: number; lon: number };
    arrival: { iata: string; name: string; lat: number; lon: number };
    departureTime: string;
    arrivalTime: string;
  };
};

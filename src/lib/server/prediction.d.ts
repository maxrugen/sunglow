import type { WeatherData } from '$lib/server/scoring';

export interface PredictionPayload {
  qualityScore: number;
  weatherData: WeatherData & {
    selectedHourIndex: number;
    selectedHour: number | undefined;
  };
  confidence: number;
  explanation: { factors: unknown };
  used: {
    /** UTC epoch seconds of the scored hour. */
    epochSec: number;
    latitude: number;
    longitude: number;
    utcOffsetSeconds: number;
  };
}

export class PredictionError extends Error {
  status: number;
  constructor(message: string, status?: number);
}

export function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retries?: number,
  timeoutMs?: number,
  backoffBaseMs?: number
): Promise<Response>;

export function fetchAirQuality(latitude: number, longitude: number): Promise<unknown | null>;

export function airQualityAt(
  aq: unknown,
  targetSec: number
): { aod: number | undefined; pm25: number | undefined };

export function predictSunset(coords: {
  latitude: number;
  longitude: number;
}): Promise<PredictionPayload>;

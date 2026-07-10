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
    epochSecLocal: number;
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

export function predictSunset(coords: {
  latitude: number;
  longitude: number;
}): Promise<PredictionPayload>;

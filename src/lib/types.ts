import type { WeatherData } from './server/scoring';

export type PredictionResponse = {
  qualityScore: number;
  confidence?: number;
  explanation?: { factors?: Record<string, unknown> };
  weatherData?: Partial<WeatherData>;
  used?: { epochSecLocal?: number; latitude?: number; longitude?: number };
};

export type ClientPrediction = {
  qualityScore: number;
  confidence?: number;
  explanation?: { factors?: Record<string, unknown> };
  timings: { sunset: Date | null; goldenHour: Date | null };
  used?: { epochSecLocal?: number; latitude?: number; longitude?: number };
};



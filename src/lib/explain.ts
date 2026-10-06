import { EVENT_COPY } from '$lib/events';
import { scoreLabel } from '$lib/score';
import type { SkyEvent } from '$lib/types';

/** Which scoring model produced the factors (see src/lib/server/scoring.ts). */
export type ExplainModel = 'ground' | 'flight';

type Factors = Record<string, Record<string, unknown> | undefined>;

/** Mirrors where each model starts penalizing, so the text matches the score. */
const THRESHOLDS: Record<ExplainModel, { humidity: number; visibilityM: number; rainMmH: number }> = {
  ground: { humidity: 75, visibilityM: 5000, rainMmH: 0.2 },
  flight: { humidity: 80, visibilityM: 3000, rainMmH: 0.5 },
};

const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/**
 * Plain-language summary of the main scoring factors. Forecasts, so present
 * or future tense ("may block"), never past ("blocked").
 */
export function explainScore(
  rawFactors: Record<string, unknown> | undefined,
  score: number,
  event: SkyEvent,
  model: ExplainModel
): string {
  if (!rawFactors) return '';
  const factors = rawFactors as Factors;
  const { noun, sunAdjective } = EVENT_COPY[event];
  const t = THRESHOLDS[model];
  const parts: string[] = [];

  const low = num(factors.lowCloud?.value);
  if (model === 'ground') {
    if (low !== undefined && low <= 25) parts.push('Clear low-level skies let the sun light up the higher clouds.');
    else if (low !== undefined && low > 60) parts.push('Extensive low cloud is likely to block the sun near the horizon.');
  } else if ((num(factors.lowCloud?.adjustment) ?? 0) > 0) {
    parts.push(`Low clouds below the plane form a cloud-top canvas for the ${noun}.`);
  }

  // `state` since scoring v2; older payloads only had the sign of `net`.
  const horizonNet = num(factors.horizon?.net);
  const horizonState =
    (factors.horizon?.state as string | undefined) ??
    (horizonNet === undefined ? undefined : horizonNet < 0 ? 'blocked' : horizonNet > 0 ? 'clear' : undefined);
  if (horizonState === 'blocked' || horizonState === 'partial') {
    parts.push(`Clouds toward the ${sunAdjective} sun may block the light before it reaches the sky overhead.`);
  } else if (horizonState === 'clear') {
    parts.push(`The sky toward the ${sunAdjective} sun looks clear, so light can reach the clouds overhead.`);
  }

  const high = num(factors.highCloud?.value);
  if (high !== undefined && high >= 40 && high <= 80) parts.push('A healthy amount of high cloud gives the light a canvas to color.');
  else if (high !== undefined && high < 20) parts.push("With very little high cloud, there isn't much to catch the color.");

  const mid = num(factors.midCloud?.value);
  if (mid !== undefined && mid >= 25 && mid <= 55) parts.push('Mid-level clouds add texture and depth.');

  if ((num(factors.humidity?.value) ?? 0) > t.humidity) {
    parts.push(model === 'ground' ? 'High humidity can wash out the colors.' : 'High humidity near the ground may mean hazier skies.');
  }
  const visibility = num(factors.visibility?.meters);
  if (visibility !== undefined && visibility > 0 && visibility < t.visibilityM) {
    parts.push(model === 'ground' ? 'Reduced visibility (haze or fog) may mute the contrast.' : 'Low visibility near the ground suggests hazy conditions.');
  }
  if (model === 'ground' && (num(factors.dewSpread?.celsius) ?? 99) < 2) {
    parts.push('A very small temperature–dew point gap suggests haze.');
  }

  const rainChance = num(factors.precipitation?.probability) ?? 0;
  const rainRate = num(factors.precipitation?.rateMmH) ?? 0;
  if (rainChance > 50 || rainRate > t.rainMmH) {
    parts.push(model === 'ground' ? `Showers around ${noun} lower the chance of vivid skies.` : 'Rain below may partly hide the horizon.');
  }

  const aod = num(factors.aod?.value);
  if (aod !== undefined && aod > 0.5) parts.push('Smoke or dust in the air is likely to mute the colors.');
  else if (aod !== undefined && aod > 0.15 && aod < 0.4 && (num(factors.aod?.bonus) ?? 0) > 0) {
    parts.push(`Moderate aerosols can make the ${noun} more vivid.`);
  }
  if (model === 'ground' && (num(factors.pm25?.ugm3) ?? 0) > 60) parts.push('Heavy particulates may dull the view.');

  const wind = num(factors.wind?.speedMs);
  if (model === 'ground' && wind !== undefined && wind >= 1 && wind <= 6) parts.push('A gentle breeze helps keep the lower air clear.');
  if ((num(factors.pressureTrend?.hPa) ?? 0) > 1) parts.push('Rising pressure hints at clearing skies.');

  if (parts.length > 0) return parts.join(' ');

  switch (scoreLabel(score)) {
    case 'Great':
      return model === 'ground' ? `Conditions look excellent for a colorful ${noun}.` : `Conditions look excellent for a stunning in-flight ${noun}.`;
    case 'Good':
      return `Conditions look decent for some color around ${noun}.`;
    case 'Fair':
      return 'Some color is possible.';
    default:
      return 'Clouds or haze will likely limit the color.';
  }
}

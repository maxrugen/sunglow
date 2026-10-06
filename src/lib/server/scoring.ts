/**
 * Identifies the scoring model behind stored predictions (see sunset_ratings).
 * Bump it whenever a change alters scores, so ratings can be grouped by model.
 *
 * v2: a moderate base for a clear sky, a cloud "canvas" term on top, and the
 * light gates (low cloud overhead, cloud toward the sun) multiplying the whole
 * score. v1 added everything up and saturated: clear skies scored ~90.
 */
export const SCORING_VERSION = 2;

export type WeatherData = {
  highCloud: number;
  midCloud: number;
  lowCloud: number;
  humidity: number;
  aod: number;
  solarAltitudeDeg?: number;
  totalCloud?: number;
  precipitationProbability?: number;
  precipitationMmPerHour?: number;
  pressureTrendHpa?: number;
  windSpeed10mMs?: number;
  visibilityM?: number;
  dewPointSpreadC?: number;
  pm25UgM3?: number;
  /** Share (0–100) of the path toward the rising/setting sun blocked by low/mid cloud. */
  horizonCloud?: number;
};

export type Evaluation = {
  score: number;
  details: Record<string, unknown>;
  confidence: number;
};

// ── Shared factors ──────────────────────────────────────────────────

/** A clear sky still gets some color: roughly the middle of "Fair". */
const CLEAR_SKY_BASE = 45;
/** What a fully lit cloud canvas adds on top. */
const CANVAS_WEIGHT = 45;

/** High cloud lit from below: the main canvas, best at 40–70%; a solid sheet is duller. */
function highCanvas(pct: number): number {
  if (pct <= 40) return Math.max(0, pct) / 40;
  if (pct <= 70) return 1;
  return 1 - (0.65 * Math.min(pct - 70, 30)) / 30;
}

/** Mid cloud adds texture, best at 20–50%; a thick mid deck blocks the light instead. */
function midCanvas(pct: number): number {
  if (pct <= 20) return Math.max(0, pct) / 20;
  if (pct <= 50) return 1;
  return Math.max(0, 1 - (pct - 50) / 40);
}

/** 0–1: how much cloud there is for the low sun to color. */
function canvasFactor(highCloud: number, midCloud: number, midWeight = 0.4): number {
  return Math.min(1, 0.65 * highCanvas(highCloud) + midWeight * midCanvas(midCloud));
}

/**
 * Light reaching the sky through the path toward the sun: 1 when clear
 * (≤15% blocked), down to 0.35 when fully blocked. Unknown counts as slightly
 * below clear, since a clear path can't be assumed.
 */
function horizonFactor(blockingPct: number | undefined): number {
  if (typeof blockingPct !== 'number') return 0.9;
  return 1 - 0.65 * Math.min(1, Math.max(0, (blockingPct - 15) / 75));
}

function horizonState(blockingPct: number | undefined): 'clear' | 'partial' | 'blocked' | 'unknown' {
  if (typeof blockingPct !== 'number') return 'unknown';
  if (blockingPct < 15) return 'clear';
  return blockingPct < 60 ? 'partial' : 'blocked';
}

/** Low cloud overhead hides the sun near the horizon. */
function lowCloudMultiplier(lowCloud: number): number {
  let multiplier = 1;
  if (lowCloud > 25) multiplier *= 1 - (lowCloud - 25) / 75;
  if (lowCloud > 80) multiplier *= 0.2;
  return Math.max(0, multiplier);
}

/** Aerosols only enhance color when the air isn't already humid or hazy. */
function aerosolAllowed(humidity: number, visibilityM: number | undefined): boolean {
  return humidity <= 85 && (visibilityM === undefined || visibilityM >= 8000);
}

/**
 * Moderate aerosols scatter warm light (peak +4 at AOD 0.3); heavy smoke or
 * dust above 0.5 mutes the colors, down to -10.
 */
function aodAdj(aod: number, allowed: boolean): number {
  if (aod > 0.5) return -Math.min(10, (aod - 0.5) * 25);
  if (!allowed || aod <= 0.05) return 0;
  if (aod <= 0.3) return (4 * (aod - 0.05)) / 0.25;
  return 4 - (4 * (aod - 0.3)) / 0.2;
}

/** Linear penalty for each point above `threshold`. */
function excessPenalty(value: number, threshold: number, rate: number): number {
  return value > threshold ? (value - threshold) * rate : 0;
}

/** Penalty for precipitation rate, scaling to `max` at `saturationMmH`. */
function precipRatePenalty(
  rateMmH: number | undefined,
  threshold: number,
  max: number,
  saturationMmH: number
): number {
  if (typeof rateMmH !== 'number' || rateMmH <= threshold) return 0;
  return max * Math.min(rateMmH / saturationMmH, 1);
}

/** Penalty scaling to `max` as visibility drops from `limitM` to 0. */
function visibilityPenalty(visibilityM: number | undefined, limitM: number, max: number): number {
  if (typeof visibilityM !== 'number' || visibilityM <= 0 || visibilityM >= limitM) return 0;
  return Math.min(max, ((limitM - visibilityM) / limitM) * max);
}

/** Rising pressure hints at clearing, falling at incoming weather. */
function pressureAdj(trendHpa: number | undefined): number {
  if (typeof trendHpa !== 'number') return 0;
  if (trendHpa > 1) return 2;
  if (trendHpa < -1) return -2;
  return 0;
}

/** Geometry bonus, best around -3° and effective in [-8°, +2°]. */
function solarAltitudeAdj(deg: number | undefined): number {
  if (typeof deg !== 'number') return 0;
  const dist = Math.abs(deg + 3);
  return dist <= 5 ? Math.round(3 * (1 - dist / 5)) : 0;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

// ── Ground-level model ──────────────────────────────────────────────

export function calculateWithDetails(weatherData: WeatherData): {
  score: number;
  details: Record<string, unknown>;
} {
  const {
    highCloud,
    midCloud,
    lowCloud,
    humidity,
    aod,
    solarAltitudeDeg,
    totalCloud,
    precipitationProbability,
    precipitationMmPerHour,
    pressureTrendHpa,
    windSpeed10mMs,
    visibilityM,
    dewPointSpreadC,
    pm25UgM3,
    horizonCloud
  } = weatherData;

  const canvas = canvasFactor(highCloud, midCloud);
  const lowMultiplier = lowCloudMultiplier(lowCloud);
  const horizon = horizonFactor(horizonCloud);
  // Both gates decide how much sunlight reaches the sky at all.
  const light = lowMultiplier * horizon;

  const sky = CLEAR_SKY_BASE + CANVAS_WEIGHT * canvas;
  let score = sky * light;
  const lowEffect = sky * horizon * (lowMultiplier - 1);
  const horizonEffect = sky * (horizon - 1);

  // Bonuses only matter if sunlight gets through, so the same gates scale them.
  // Penalties stay whole: they describe conditions that hurt regardless.
  const gate = (adj: number) => (adj > 0 ? adj * light : adj);

  const humidityPenalty = excessPenalty(humidity, 75, 0.4);
  score -= humidityPenalty;

  const allowed = aerosolAllowed(humidity, visibilityM);
  const aerosol = gate(aodAdj(aod, allowed));
  score += aerosol;

  const precipProbPenalty =
    typeof precipitationProbability === 'number' ? excessPenalty(precipitationProbability, 40, 0.2) : 0;
  score -= precipProbPenalty;

  const precipPenalty = precipRatePenalty(precipitationMmPerHour, 0.2, 10, 2);
  score -= precipPenalty;

  const visPenalty = visibilityPenalty(visibilityM, 5000, 15);
  score -= visPenalty;

  let dewSpreadAdj = 0;
  if (typeof dewPointSpreadC === 'number') {
    if (dewPointSpreadC < 2) dewSpreadAdj = -6;
    else if (dewPointSpreadC < 5) dewSpreadAdj = -3;
    else if (dewPointSpreadC > 8) dewSpreadAdj = +1;
  }
  dewSpreadAdj = gate(dewSpreadAdj);
  score += dewSpreadAdj;

  let windAdj = 0;
  if (typeof windSpeed10mMs === 'number') {
    if (windSpeed10mMs < 1) windAdj = -3;
    else if (windSpeed10mMs <= 6) windAdj = +1;
    else if (windSpeed10mMs > 10) windAdj = -3;
  }
  windAdj = gate(windAdj);
  score += windAdj;

  const pressure = gate(pressureAdj(pressureTrendHpa));
  score += pressure;

  let pm25Adj = 0;
  if (typeof pm25UgM3 === 'number') {
    // Moderate particulates help only when the air is otherwise clear.
    if (pm25UgM3 >= 10 && pm25UgM3 <= 35 && allowed) pm25Adj = +2;
    else if (pm25UgM3 > 60) pm25Adj = -6;
  }
  pm25Adj = gate(pm25Adj);
  score += pm25Adj;

  const solarAdj = gate(solarAltitudeAdj(solarAltitudeDeg));
  score += solarAdj;

  const totalCloudAdj = typeof totalCloud === 'number' && totalCloud > 90 ? -5 : 0;
  score += totalCloudAdj;

  return {
    score: clampScore(score),
    details: {
      canvas: { factor: Number(canvas.toFixed(2)), net: Math.round(CANVAS_WEIGHT * canvas * light) },
      highCloud: { value: highCloud, net: Math.round(CANVAS_WEIGHT * 0.65 * highCanvas(highCloud) * light) },
      midCloud: { value: midCloud, net: Math.round(CANVAS_WEIGHT * 0.4 * midCanvas(midCloud) * light) },
      lowCloud: { value: lowCloud, multiplier: Number(lowMultiplier.toFixed(2)), effect: Math.round(lowEffect), heavyOvercast: lowCloud > 80 },
      humidity: { value: humidity, penalty: Math.round(-humidityPenalty) },
      aod: { value: aod, bonus: Math.round(aerosol) },
      precipitation: { probability: precipitationProbability, rateMmH: precipitationMmPerHour, penaltyProb: Math.round(-precipProbPenalty), penaltyRate: Math.round(-precipPenalty) },
      visibility: { meters: visibilityM, penalty: Math.round(-visPenalty) },
      dewSpread: { celsius: dewPointSpreadC, net: Math.round(dewSpreadAdj) },
      wind: { speedMs: windSpeed10mMs, net: Math.round(windAdj) },
      pressureTrend: { hPa: pressureTrendHpa, net: Math.round(pressure) },
      totalCloud: { value: totalCloud, net: totalCloudAdj },
      pm25: { ugm3: pm25UgM3, net: Math.round(pm25Adj) },
      solarAltitude: { deg: solarAltitudeDeg, net: Math.round(solarAdj) },
      horizon: {
        blockingPct: horizonCloud,
        factor: Number(horizon.toFixed(2)),
        state: horizonState(horizonCloud),
        net: Math.round(horizonEffect),
      }
    }
  };
}

/**
 * 0–100: how much to trust the score. `leadHours` is how far ahead the event
 * is; forecasts for tomorrow evening are less certain than for the next hour,
 * and next week's much less.
 */
export function calculateConfidence(weatherData: WeatherData, alignedToEvent: boolean, leadHours = 0): number {
  let confidence = 90;

  const pop = weatherData.precipitationProbability ?? 0;
  const precip = weatherData.precipitationMmPerHour ?? 0;
  const low = weatherData.lowCloud ?? 0;
  const vis = weatherData.visibilityM;
  const pm25 = weatherData.pm25UgM3;

  if (pop > 50 || precip > 0.2) confidence -= 25;
  if (low > 60) confidence -= 25;
  if (vis !== undefined && vis < 5000) confidence -= 15;
  if (pm25 !== undefined && pm25 > 60) confidence -= 10;
  if (!alignedToEvent) confidence -= 10;
  const lead = Math.max(0, leadHours);
  confidence -= Math.min(15, Math.floor(lead / 3));
  // Beyond two days forecast skill keeps dropping (the week outlook): about -4 a day, -20 at most.
  if (lead > 48) confidence -= Math.min(20, Math.floor((lead - 48) / 6));

  return clampScore(confidence);
}

export function evaluate(weatherData: WeatherData, alignedToEvent: boolean, leadHours = 0): Evaluation {
  const { score, details } = calculateWithDetails(weatherData);
  const confidence = calculateConfidence(weatherData, alignedToEvent, leadHours);
  return { score, details, confidence };
}

// ── In-flight model ─────────────────────────────────────────────────

/** From cruise altitude the view is above most weather, so a clear sky rates a bit higher. */
const FLIGHT_CLEAR_BASE = 50;
const FLIGHT_CANVAS_WEIGHT = 40;

/**
 * In-flight sunrise/sunset scoring: adapts the ground-level model for cruise altitude (~10km).
 *
 * Key differences from ground-level evaluate():
 * - Mid and low clouds are mostly *below* the plane: they form a "carpet"
 *   (mild bonus) rather than blocking the sun; only high cloud is the canvas
 * - No horizon sampling and no PM2.5 (irrelevant at altitude)
 * - Humidity, precipitation, visibility and surface wind matter less
 * - Confidence is lower because forecasts are surface-level
 */
export function evaluateInFlight(weatherData: WeatherData, alignedToEvent: boolean): Evaluation {
  const {
    highCloud,
    midCloud,
    lowCloud,
    humidity,
    aod,
    solarAltitudeDeg,
    totalCloud,
    precipitationProbability,
    precipitationMmPerHour,
    pressureTrendHpa,
    windSpeed10mMs,
    visibilityM,
    dewPointSpreadC,
  } = weatherData;

  // Mid cloud below the plane adds texture to the view, but isn't the main canvas.
  const canvas = canvasFactor(highCloud, midCloud, 0.25);
  let score = FLIGHT_CLEAR_BASE + FLIGHT_CANVAS_WEIGHT * canvas;

  // Low clouds below the plane form a cloud-top canvas instead of blocking the sun.
  let lowCloudAdj = 0;
  if (lowCloud > 20 && lowCloud <= 70) lowCloudAdj = +3;
  else if (lowCloud > 70) lowCloudAdj = +2;
  score += lowCloudAdj;

  const humidityPenalty = excessPenalty(humidity, 80, 0.3);
  score -= humidityPenalty;

  const aerosol = aodAdj(aod, aerosolAllowed(humidity, visibilityM));
  score += aerosol;

  const precipProbPenalty =
    typeof precipitationProbability === 'number' ? excessPenalty(precipitationProbability, 50, 0.15) : 0;
  score -= precipProbPenalty;

  const precipPenalty = precipRatePenalty(precipitationMmPerHour, 0.5, 6, 3);
  score -= precipPenalty;

  const visPenalty = visibilityPenalty(visibilityM, 3000, 8);
  score -= visPenalty;

  let dewSpreadAdj = 0;
  if (typeof dewPointSpreadC === 'number') {
    if (dewPointSpreadC < 2) dewSpreadAdj = -3;
    else if (dewPointSpreadC > 8) dewSpreadAdj = +1;
  }
  score += dewSpreadAdj;

  const windAdj = typeof windSpeed10mMs === 'number' && windSpeed10mMs <= 6 ? +1 : 0;
  score += windAdj;

  const pressure = pressureAdj(pressureTrendHpa);
  score += pressure;

  const solarAdj = solarAltitudeAdj(solarAltitudeDeg);
  score += solarAdj;

  // A complete high overcast can put the plane in or under it.
  const totalCloudAdj = typeof totalCloud === 'number' && totalCloud > 95 && highCloud > 80 ? -5 : 0;
  score += totalCloudAdj;

  let confidence = 80; // baseline lower than ground's 90
  const pop = precipitationProbability ?? 0;
  const precip = precipitationMmPerHour ?? 0;
  if (pop > 50 || precip > 0.5) confidence -= 15;
  if (highCloud > 80) confidence -= 15; // high cloud at cruise is the main concern
  if (!alignedToEvent) confidence -= 10;
  confidence -= 5; // surface weather may not reflect conditions at 10km

  return {
    score: clampScore(score),
    details: {
      canvas: { factor: Number(canvas.toFixed(2)), net: Math.round(FLIGHT_CANVAS_WEIGHT * canvas) },
      highCloud: { value: highCloud, net: Math.round(FLIGHT_CANVAS_WEIGHT * 0.65 * highCanvas(highCloud)) },
      midCloud: { value: midCloud, net: Math.round(FLIGHT_CANVAS_WEIGHT * 0.25 * midCanvas(midCloud)) },
      lowCloud: { value: lowCloud, adjustment: lowCloudAdj, note: 'inverted for altitude' },
      humidity: { value: humidity, penalty: Math.round(-humidityPenalty) },
      aod: { value: aod, bonus: Math.round(aerosol) },
      precipitation: { probability: precipitationProbability, rateMmH: precipitationMmPerHour, penaltyProb: Math.round(-precipProbPenalty), penaltyRate: Math.round(-precipPenalty) },
      visibility: { meters: visibilityM, penalty: Math.round(-visPenalty) },
      dewSpread: { celsius: dewPointSpreadC, net: dewSpreadAdj },
      wind: { speedMs: windSpeed10mMs, net: windAdj },
      pressureTrend: { hPa: pressureTrendHpa, net: pressure },
      totalCloud: { value: totalCloud, net: totalCloudAdj },
      solarAltitude: { deg: solarAltitudeDeg, net: solarAdj },
      pm25: { ugm3: undefined, net: 0, note: 'irrelevant at cruise altitude' }
    },
    confidence: clampScore(confidence)
  };
}

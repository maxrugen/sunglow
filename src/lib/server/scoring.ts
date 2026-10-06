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
  /** Share (0–100) of the path toward the setting sun blocked by low/mid cloud. */
  horizonCloud?: number;
};

export type Evaluation = {
  score: number;
  details: Record<string, unknown>;
  confidence: number;
};

// ── Factors shared by the ground and in-flight models ───────────────

/** High cloud is the main color canvas; net bonus peaks at 60% cover. */
function highCloudNet(highCloud: number): number {
  return 30 * (1 - Math.abs(highCloud - 60) / 60) - 15;
}

/** Mid cloud adds texture; net bonus peaks at 40% cover. */
function midCloudNet(midCloud: number): number {
  return 20 * (1 - Math.abs(midCloud - 40) / 40) - 10;
}

/** Aerosols only enhance color when the air isn't already humid or hazy. */
function aerosolAllowed(humidity: number, visibilityM: number | undefined): boolean {
  return humidity <= 85 && (visibilityM === undefined || visibilityM >= 8000);
}

function aodBonus(aod: number, allowed: boolean): number {
  return aod > 0.15 && aod < 0.4 && allowed ? 10 : 0;
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
  if (trendHpa > 1) return 3;
  if (trendHpa < -1) return -3;
  return 0;
}

/** Geometry bonus, best around -3° and effective in [-8°, +2°]. */
function solarAltitudeAdj(deg: number | undefined): number {
  if (typeof deg !== 'number') return 0;
  const dist = Math.abs(deg + 3);
  return dist <= 5 ? Math.round(6 * (1 - dist / 5)) : 0;
}

/**
 * Cloud toward the sun cuts off the light that colors clouds overhead. A clear
 * path earns a small bonus; beyond 35% blocking the penalty grows to -25 at 85%.
 */
function horizonAdj(blockingPct: number | undefined): number {
  if (typeof blockingPct !== 'number') return 0;
  if (blockingPct < 15) return 4;
  if (blockingPct <= 35) return 0;
  return -Math.round(Math.min(1, (blockingPct - 35) / 50) * 25);
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

  const netHigh = highCloudNet(highCloud);
  const netMid = midCloudNet(midCloud);
  let score = 100 + netHigh + netMid;

  // Low cloud blocks the sun near the horizon, so it scales the whole score.
  let lowMultiplier = 1;
  let heavyOvercast = false;
  if (lowCloud > 25) lowMultiplier *= 1 - (lowCloud - 25) / 75;
  if (lowCloud > 80) {
    lowMultiplier *= 0.2;
    heavyOvercast = true;
  }
  const beforeLow = score;
  score *= lowMultiplier;
  const lowEffect = score - beforeLow;

  const humidityPenalty = excessPenalty(humidity, 75, 0.5);
  score -= humidityPenalty;

  const allowed = aerosolAllowed(humidity, visibilityM);
  const aodAdj = aodBonus(aod, allowed);
  score += aodAdj;

  const precipProbPenalty =
    typeof precipitationProbability === 'number' ? excessPenalty(precipitationProbability, 40, 0.2) : 0;
  score -= precipProbPenalty;

  const precipPenalty = precipRatePenalty(precipitationMmPerHour, 0.2, 10, 2);
  score -= precipPenalty;

  const visPenalty = visibilityPenalty(visibilityM, 5000, 15);
  score -= visPenalty;

  let dewSpreadAdj = 0;
  if (typeof dewPointSpreadC === 'number') {
    if (dewPointSpreadC < 2) dewSpreadAdj = -8;
    else if (dewPointSpreadC < 5) dewSpreadAdj = -4;
    else if (dewPointSpreadC > 8) dewSpreadAdj = +2;
  }
  score += dewSpreadAdj;

  let windAdj = 0;
  if (typeof windSpeed10mMs === 'number') {
    if (windSpeed10mMs < 1) windAdj = -4;
    else if (windSpeed10mMs <= 6) windAdj = +3;
    else if (windSpeed10mMs > 10) windAdj = -4;
  }
  score += windAdj;

  const pressure = pressureAdj(pressureTrendHpa);
  score += pressure;

  let pm25Adj = 0;
  if (typeof pm25UgM3 === 'number') {
    // Moderate particulates help only when the air is otherwise clear.
    if (pm25UgM3 >= 10 && pm25UgM3 <= 35 && allowed) pm25Adj = +4;
    else if (pm25UgM3 > 60) pm25Adj = -8;
  }
  score += pm25Adj;

  const solarAdj = solarAltitudeAdj(solarAltitudeDeg);
  score += solarAdj;

  const totalCloudAdj = typeof totalCloud === 'number' && totalCloud > 90 ? -5 : 0;
  score += totalCloudAdj;

  const horizon = horizonAdj(horizonCloud);
  score += horizon;

  return {
    score: clampScore(score),
    details: {
      highCloud: { value: highCloud, net: Math.round(netHigh) },
      midCloud: { value: midCloud, net: Math.round(netMid) },
      lowCloud: { value: lowCloud, multiplier: Number(lowMultiplier.toFixed(2)), effect: Math.round(lowEffect), heavyOvercast },
      humidity: { value: humidity, penalty: Math.round(-humidityPenalty) },
      aod: { value: aod, bonus: aodAdj },
      precipitation: { probability: precipitationProbability, rateMmH: precipitationMmPerHour, penaltyProb: Math.round(-precipProbPenalty), penaltyRate: Math.round(-precipPenalty) },
      visibility: { meters: visibilityM, penalty: Math.round(-visPenalty) },
      dewSpread: { celsius: dewPointSpreadC, net: dewSpreadAdj },
      wind: { speedMs: windSpeed10mMs, net: windAdj },
      pressureTrend: { hPa: pressureTrendHpa, net: pressure },
      totalCloud: { value: totalCloud, net: totalCloudAdj },
      pm25: { ugm3: pm25UgM3, net: pm25Adj },
      solarAltitude: { deg: solarAltitudeDeg, net: solarAdj },
      horizon: { blockingPct: horizonCloud, net: horizon }
    }
  };
}

export function calculateConfidence(weatherData: WeatherData, alignedToSunset: boolean): number {
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
  if (!alignedToSunset) confidence -= 10;

  return clampScore(confidence);
}

export function evaluate(weatherData: WeatherData, alignedToSunset: boolean): Evaluation {
  const { score, details } = calculateWithDetails(weatherData);
  const confidence = calculateConfidence(weatherData, alignedToSunset);
  return { score, details, confidence };
}

// ── In-flight model ─────────────────────────────────────────────────

/**
 * In-flight sunset scoring: adapts the ground-level model for cruise altitude (~10km).
 *
 * Key differences from ground-level evaluate():
 * - Low clouds are *below* the plane → penalty is inverted to a mild bonus (cloud-top sunsets)
 * - PM2.5 is irrelevant at altitude → ignored
 * - Humidity, precipitation, visibility and surface wind matter less
 * - Confidence is lower because forecasts are surface-level
 */
export function evaluateInFlight(weatherData: WeatherData, alignedToSunset: boolean): Evaluation {
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

  const netHigh = highCloudNet(highCloud);
  const netMid = midCloudNet(midCloud);
  let score = 100 + netHigh + netMid;

  // Low clouds below the plane form a cloud-top canvas instead of blocking the sun.
  let lowCloudAdj = 0;
  if (lowCloud > 20 && lowCloud <= 70) lowCloudAdj = +5;
  else if (lowCloud > 70) lowCloudAdj = +3;
  score += lowCloudAdj;

  const humidityPenalty = excessPenalty(humidity, 80, 0.3);
  score -= humidityPenalty;

  const aodAdj = aodBonus(aod, aerosolAllowed(humidity, visibilityM));
  score += aodAdj;

  const precipProbPenalty =
    typeof precipitationProbability === 'number' ? excessPenalty(precipitationProbability, 50, 0.15) : 0;
  score -= precipProbPenalty;

  const precipPenalty = precipRatePenalty(precipitationMmPerHour, 0.5, 6, 3);
  score -= precipPenalty;

  const visPenalty = visibilityPenalty(visibilityM, 3000, 8);
  score -= visPenalty;

  let dewSpreadAdj = 0;
  if (typeof dewPointSpreadC === 'number') {
    if (dewPointSpreadC < 2) dewSpreadAdj = -4;
    else if (dewPointSpreadC > 8) dewSpreadAdj = +1;
  }
  score += dewSpreadAdj;

  const windAdj = typeof windSpeed10mMs === 'number' && windSpeed10mMs <= 6 ? +1 : 0;
  score += windAdj;

  const pressure = pressureAdj(pressureTrendHpa);
  score += pressure;

  const solarAdj = solarAltitudeAdj(solarAltitudeDeg);
  score += solarAdj;

  const totalCloudAdj = typeof totalCloud === 'number' && totalCloud > 95 ? -3 : 0;
  score += totalCloudAdj;

  let confidence = 80; // baseline lower than ground's 90
  const pop = precipitationProbability ?? 0;
  const precip = precipitationMmPerHour ?? 0;
  if (pop > 50 || precip > 0.5) confidence -= 15;
  if (highCloud > 80) confidence -= 15; // high cloud at cruise is the main concern
  if (!alignedToSunset) confidence -= 10;
  confidence -= 5; // surface weather may not reflect conditions at 10km

  return {
    score: clampScore(score),
    details: {
      highCloud: { value: highCloud, net: Math.round(netHigh) },
      midCloud: { value: midCloud, net: Math.round(netMid) },
      lowCloud: { value: lowCloud, adjustment: lowCloudAdj, note: 'inverted for altitude' },
      humidity: { value: humidity, penalty: Math.round(-humidityPenalty) },
      aod: { value: aod, bonus: aodAdj },
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

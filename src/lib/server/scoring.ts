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
};

export function calculateSunsetQuality(weatherData: WeatherData): number {
  const { highCloud, midCloud, lowCloud, humidity, aod } = weatherData;

  let score = 100.0;

  // 1. High-Cloud Bonus (peaks at 60%)
  const highCloudBonus = 30 * (1 - Math.abs(highCloud - 60) / 60);
  score += highCloudBonus - 15;

  // 2. Mid-Cloud Contribution (peaks at 40%)
  const midCloudBonus = 20 * (1 - Math.abs(midCloud - 40) / 40);
  score += midCloudBonus - 10;

  // 3. Low-Cloud Penalty
  if (lowCloud > 25) {
    score *= 1 - (lowCloud - 25) / 75;
  }
  if (lowCloud > 80) {
    score *= 0.2;
  }

  // 4. Humidity Damper
  if (humidity > 75) {
    score -= (humidity - 75) * 0.5;
  }

  // 5. Aerosol Enhancer
  if (aod > 0.15 && aod < 0.4) {
    score += 10;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

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
    pm25UgM3
  } = weatherData;

  let score = 100.0;

  // High & mid cloud bonuses
  const highCloudBonus = 30 * (1 - Math.abs(highCloud - 60) / 60);
  const netHigh = highCloudBonus - 15;
  score += netHigh;

  const midCloudBonus = 20 * (1 - Math.abs(midCloud - 40) / 40);
  const netMid = midCloudBonus - 10;
  score += netMid;

  // Low cloud penalties (multiplicative)
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

  // Humidity damper (additive)
  let humidityPenalty = 0;
  if (humidity > 75) {
    humidityPenalty = (humidity - 75) * 0.5;
    score -= humidityPenalty;
  }

  // AOD bonus
  let aodBonus = 0;
  // Only grant AOD bonus when not overly humid/hazy
  const aerosolAllowed = (humidity <= 85) && (visibilityM === undefined || visibilityM >= 8000);
  if (aod > 0.15 && aod < 0.4 && aerosolAllowed) {
    aodBonus = 10;
    score += aodBonus;
  }

  // Additional signals (additive adjustments)
  let precipProbPenalty = 0;
  if (typeof precipitationProbability === 'number') {
    precipProbPenalty = Math.max(0, precipitationProbability - 40) * 0.2;
    score -= precipProbPenalty;
  }

  let precipRatePenalty = 0;
  if (typeof precipitationMmPerHour === 'number' && precipitationMmPerHour > 0.2) {
    precipRatePenalty = 10 * Math.min(precipitationMmPerHour / 2, 1);
    score -= precipRatePenalty;
  }

  let visibilityPenalty = 0;
  if (typeof visibilityM === 'number' && visibilityM > 0 && visibilityM < 5000) {
    visibilityPenalty = Math.min(15, ((5000 - visibilityM) / 5000) * 15);
    score -= visibilityPenalty;
  }

  let dewSpreadAdj = 0;
  if (typeof dewPointSpreadC === 'number') {
    if (dewPointSpreadC < 2) dewSpreadAdj = -8;
    else if (dewPointSpreadC < 5) dewSpreadAdj = -4;
    else if (dewPointSpreadC > 8) dewSpreadAdj = +2;
    score += dewSpreadAdj;
  }

  let windAdj = 0;
  if (typeof windSpeed10mMs === 'number') {
    if (windSpeed10mMs < 1) windAdj = -4;
    else if (windSpeed10mMs <= 6) windAdj = +3;
    else if (windSpeed10mMs > 10) windAdj = -4;
    score += windAdj;
  }

  let pressureAdj = 0;
  if (typeof pressureTrendHpa === 'number') {
    if (pressureTrendHpa > 1) pressureAdj = +3;
    else if (pressureTrendHpa < -1) pressureAdj = -3;
    score += pressureAdj;
  }

  let pm25Adj = 0;
  if (typeof pm25UgM3 === 'number') {
    // Apply PM2.5 positive effect only when air is reasonably clear
    if (pm25UgM3 >= 10 && pm25UgM3 <= 35 && aerosolAllowed) pm25Adj = +4;
    else if (pm25UgM3 > 60) pm25Adj = -8;
    score += pm25Adj;
  }

  // Solar altitude band weighting (best around -3°, effective in [-8°, +2°])
  let solarAdj = 0;
  if (typeof solarAltitudeDeg === 'number') {
    const center = -3;
    const halfWidth = 5; // window from -8 to +2 deg
    const dist = Math.abs(solarAltitudeDeg - center);
    if (dist <= halfWidth) {
      solarAdj = Math.round(6 * (1 - dist / halfWidth)); // up to +6
      score += solarAdj;
    }
  }

  let totalCloudAdj = 0;
  if (typeof totalCloud === 'number' && totalCloud > 90) {
    totalCloudAdj = -5;
    score += totalCloudAdj;
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score: clamped,
    details: {
      highCloud: { value: highCloud, net: Math.round(netHigh) },
      midCloud: { value: midCloud, net: Math.round(netMid) },
      lowCloud: { value: lowCloud, multiplier: Number(lowMultiplier.toFixed(2)), effect: Math.round(lowEffect), heavyOvercast },
      humidity: { value: humidity, penalty: Math.round(-humidityPenalty) },
      aod: { value: aod, bonus: aodBonus },
      precipitation: { probability: precipitationProbability, rateMmH: precipitationMmPerHour, penaltyProb: Math.round(-precipProbPenalty), penaltyRate: Math.round(-precipRatePenalty) },
      visibility: { meters: visibilityM, penalty: Math.round(-visibilityPenalty) },
      dewSpread: { celsius: dewPointSpreadC, net: dewSpreadAdj },
      wind: { speedMs: windSpeed10mMs, net: windAdj },
      pressureTrend: { hPa: pressureTrendHpa, net: pressureAdj },
      totalCloud: { value: totalCloud, net: totalCloudAdj },
      pm25: { ugm3: pm25UgM3, net: pm25Adj },
      solarAltitude: { deg: solarAltitudeDeg, net: solarAdj }
    }
  };
}


export function calculateConfidence(weatherData: WeatherData, alignedToSunset: boolean): number {
  let confidence = 90;

  const pop = weatherData.precipitationProbability ?? 0;
  const precip = weatherData.precipitationMmPerHour ?? 0;
  const low = weatherData.lowCloud ?? 0;
  const vis = weatherData.visibilityM ?? undefined;
  const pm25 = weatherData.pm25UgM3 ?? undefined;

  if (pop > 50 || precip > 0.2) confidence -= 25;
  if (low > 60) confidence -= 25;
  if (vis !== undefined && vis < 5000) confidence -= 15;
  if (pm25 !== undefined && pm25 > 60) confidence -= 10;
  if (!alignedToSunset) confidence -= 10;

  return Math.max(0, Math.min(100, Math.round(confidence)));
}

export function evaluate(weatherData: WeatherData, alignedToSunset: boolean): {
  score: number;
  details: Record<string, unknown>;
  confidence: number;
} {
  const { score, details } = calculateWithDetails(weatherData);
  const confidence = calculateConfidence(weatherData, alignedToSunset);
  return { score, details, confidence };
}



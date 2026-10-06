type BigDataCloudResponse = {
  city?: string;
  locality?: string;
  principalSubdivision?: string;
  countryName?: string;
  localityInfo?: { administrative?: Array<{ name?: string }> };
};

/**
 * Friendly place name ("Berlin, Germany") for coordinates, or null.
 * Uses BigDataCloud's free reverse-geocode-client API, which is meant to be
 * called from browsers (it rate-limits server IPs). Open-Meteo has no reverse
 * geocoding endpoint.
 */
export async function reverseGeocode(
  latitude: number,
  longitude: number,
  fetchFn: typeof fetch = fetch
): Promise<string | null> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    localityLanguage: 'en',
  });
  try {
    const res = await fetchFn(`https://api.bigdatacloud.net/data/reverse-geocode-client?${params.toString()}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as BigDataCloudResponse;
    const name = d.city || d.locality || d.principalSubdivision || d.localityInfo?.administrative?.[0]?.name;
    const region = d.principalSubdivision && d.principalSubdivision !== name ? d.principalSubdivision : '';
    return [name, region, d.countryName].filter(Boolean).join(', ') || null;
  } catch {
    return null;
  }
}

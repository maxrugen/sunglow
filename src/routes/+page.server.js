/** @type {import('./$types').PageServerLoad} */
export async function load({ fetch, url }) {
  const lat = url.searchParams.get('lat');
  const lon = url.searchParams.get('lon');
  const label = url.searchParams.get('label') || '';

  if (lat && lon) {
    try {
      const res = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: Number(lat), longitude: Number(lon) })
      });
      if (res.ok) {
        const json = await res.json();
        return {
          ssr: {
            latitude: Number(lat),
            longitude: Number(lon),
            label,
            qualityScore: json?.qualityScore ?? 0,
            confidence: json?.confidence ?? undefined
          }
        };
      }
    } catch {}
  }

  return {};
}



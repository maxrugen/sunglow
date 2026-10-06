import { json, type RequestHandler } from '@sveltejs/kit';
import { fallbackQueries, primaryQuery } from '#lib/server/geocode.js';

const MAX_QUERY_LENGTH = 100;

type GeocodeHit = { id?: number; name?: string; country?: string; admin1?: string; latitude?: number; longitude?: number };

/**
 * GET /api/geocode?q=Berlin → up to 5 places from Open-Meteo's geocoding API.
 * "Jackson Wyoming" is retried as "Jackson, Wyoming" when the plain search
 * finds nothing (see src/lib/server/geocode.ts), so those cost extra requests
 * only when needed.
 */
export const GET: RequestHandler = async ({ url, fetch }) => {
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH);
    if (!q) return json({ results: [] });

    async function search(name: string): Promise<GeocodeHit[]> {
        const params = new URLSearchParams({ name, count: '5', format: 'json' });
        const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`, {
            signal: AbortSignal.timeout(5000)
        });
        if (!res.ok) throw new Error(`geocoding API returned ${res.status}`);
        return ((await res.json()) as { results?: GeocodeHit[] }).results ?? [];
    }

    try {
        let hits: GeocodeHit[] = [];
        for (const name of [primaryQuery(q), ...fallbackQueries(q)]) {
            hits = await search(name);
            if (hits.length > 0) break;
        }
        const results = hits.map((r) => ({
            id: r.id,
            name: r.name,
            country: r.country,
            admin1: r.admin1,
            latitude: r.latitude,
            longitude: r.longitude
        }));
        // Place names don't change; let browsers and the CDN reuse answers.
        return json({ results }, { headers: { 'Cache-Control': 'public, max-age=86400' } });
    } catch (err) {
        console.error('[geocode]', err);
        // An error (not an empty list), so the UI says the search failed rather than "No results".
        return json({ error: 'City search is unavailable right now.' }, { status: 502 });
    }
};

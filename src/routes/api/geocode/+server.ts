import { json, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url, fetch }) => {
    const q = url.searchParams.get('q')?.trim() || '';
    if (!q) return json({ results: [] });

    const params = new URLSearchParams({ name: q, count: '5', format: 'json' });
    const apiUrl = `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`;

    const res = await fetch(apiUrl);
    if (!res.ok) return json({ results: [] }, { status: 200 });

    const data = await res.json();
    const results = (data?.results || []).map((r: any) => ({
        id: r?.id,
        name: r?.name,
        country: r?.country,
        admin1: r?.admin1,
        latitude: r?.latitude,
        longitude: r?.longitude
    }));

    return json({ results });
};



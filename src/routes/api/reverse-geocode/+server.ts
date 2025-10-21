import { json, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url, fetch }) => {
    const lat = url.searchParams.get('latitude');
    const lon = url.searchParams.get('longitude');
    const latitude = Number(lat);
    const longitude = Number(lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return json({ error: 'Invalid coordinates' }, { status: 400 });
    }

    try {
        const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), count: '1', format: 'json' });
        const apiUrl = `https://geocoding-api.open-meteo.com/v1/reverse?${params.toString()}`;
        const res = await fetch(apiUrl);
        if (res.ok) {
            const data = await res.json();
            const r = data?.results?.[0];
            if (r) {
                const label = `${r.name}${r.admin1 ? `, ${r.admin1}` : ''}, ${r.country}`;
                return json({ label, result: r });
            }
        }
    } catch {}

    try {
        const fallbackUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&localityLanguage=en`;
        const res2 = await fetch(fallbackUrl);
        if (res2.ok) {
            const d2 = await res2.json();
            const name = d2?.city || d2?.locality || d2?.principalSubdivision || d2?.localityInfo?.administrative?.[0]?.name;
            const country = d2?.countryName || '';
            const admin1 = d2?.principalSubdivision || '';
            const label = [name, admin1 && admin1 !== name ? admin1 : '', country].filter(Boolean).join(', ');
            return json({ label });
        }
    } catch {}

    return json({ label: '' });
};



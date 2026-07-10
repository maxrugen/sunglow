import { json } from '@sveltejs/kit';
import { predictSunset, PredictionError } from '$lib/server/prediction';

export async function POST({ request }) {
    try {
        const body = await request.json();
        const latitude = Number(body?.latitude);
        const longitude = Number(body?.longitude);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return json({ error: 'Invalid or missing latitude/longitude' }, { status: 400 });
        }

        const payload = await predictSunset({ latitude, longitude });

        // Cache headers: allow short-term caching by proxies/clients; adjust as needed
        return json(payload, { headers: { 'Cache-Control': 'public, max-age=120' } });
    } catch (err) {
        if (err instanceof PredictionError) {
            return json({ error: err.message }, { status: err.status });
        }
        return json({ error: 'Request processing failed', message: err?.message || String(err) }, { status: 400 });
    }
}

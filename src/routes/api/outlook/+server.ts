import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PredictionError } from '#lib/server/prediction.js';
import { predictOutlook } from '#lib/server/outlook.js';
import { parseLatLon } from '#lib/server/validate.js';

/** GET /api/outlook?lat=52.52&lon=13.41&event=sunset → scores for the next week of sunsets. */
export const GET: RequestHandler = async ({ url }) => {
  const coords = parseLatLon(url.searchParams.get('lat'), url.searchParams.get('lon'));
  if (!coords) {
    return json({ error: 'Invalid or missing latitude/longitude' }, { status: 400 });
  }
  const event = url.searchParams.get('event') ?? 'sunset';
  if (event !== 'sunset' && event !== 'sunrise') {
    return json({ error: "event must be 'sunset' or 'sunrise'" }, { status: 400 });
  }

  try {
    const outlook = await predictOutlook({ ...coords, event });
    // Forecasts update hourly; the server also caches per location and event hour.
    return json(outlook, { headers: { 'Cache-Control': 'public, max-age=600' } });
  } catch (err) {
    if (err instanceof PredictionError) {
      return json({ error: err.message }, { status: err.status });
    }
    console.error('[outlook]', err);
    return json({ error: 'Outlook failed' }, { status: 500 });
  }
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchAirlines } from '#lib/server/airlines.js';

/** GET /api/airlines?q=delta → up to 8 matching airlines. */
export const GET: RequestHandler = ({ url }) => {
  const results = searchAirlines(url.searchParams.get('q') ?? '');
  // The dataset is static, so results can be cached aggressively.
  return json({ results }, { headers: { 'Cache-Control': 'public, max-age=86400' } });
};

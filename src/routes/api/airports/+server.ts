import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchAirports } from '#lib/server/airports.js';

/** GET /api/airports?q=MUC → up to 8 matching airports. */
export const GET: RequestHandler = ({ url }) => {
  const results = searchAirports(url.searchParams.get('q') ?? '');
  // The dataset is static, so results can be cached aggressively.
  return json({ results }, { headers: { 'Cache-Control': 'public, max-age=86400' } });
};

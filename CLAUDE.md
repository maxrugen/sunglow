# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # start dev server at http://localhost:5173
npm run build        # production build
npm run preview      # preview production build
npm run typecheck    # svelte-check (TypeScript)
npm test             # vitest (server logic: scoring, weather, flight, prediction)
npm run db:generate  # drizzle-kit: generate SQL migration from schema
npm run db:push      # drizzle-kit: push schema to the database
```

Weather and geocoding APIs are public. Push alerts need `DATABASE_URL` (Neon), VAPID keys and `CRON_SECRET`; flight-number lookup needs `AVIATIONSTACK_API_KEY`. See `.env.example`.

## Architecture

Sunglow is a SvelteKit app (Svelte 5, runes) that predicts sunset quality for a location or during a flight. It's deployed to Vercel with `@sveltejs/adapter-vercel` on Node.js 24.x.

### Location prediction

1. `LocationInput.svelte` (city search via `/api/geocode`, or geolocation) → `+page.svelte` POSTs coordinates to `/api/predict`.
2. `predictSunset()` in `src/lib/server/prediction.ts`:
   - `upcomingSunset()` picks tonight's sunset, or tomorrow's once tonight's afterglow (30 min) has passed.
   - Fetches the hourly forecast and air quality (AOD, PM2.5) in parallel via `src/lib/server/weather.ts`.
   - Selects the hour nearest sunset, builds a weighted composite, scores it with `evaluate()`.
   - Returns score, confidence, factor details, `day`, and sunset/golden-hour `timings` (the client doesn't run SunCalc).
   - Cached in memory by (rounded lat/lon, sunset hour), checked before any upstream call.
3. Deep links `/?lat=&lon=&label=` are rendered by `+page.server.ts`, which calls `predictSunset()` directly.

### Flight prediction

`/api/predict-flight`: resolves times (`flight-time.ts`), interpolates the great-circle route and finds waypoints near local sunset (`flight-route.ts`), fetches weather at the best waypoint, scores with `evaluateInFlight()`, and picks the seat side from sun azimuth vs. heading. Airports come from `src/lib/server/airports.ts` (server-only; the client searches via `/api/airports?q=`).

### Push alerts

- `PushSubscribeButton.svelte` subscribes via `src/service-worker.ts` and POSTs to `/api/push/subscribe` (Neon via Drizzle, `src/lib/server/db/`).
- `/api/cron` runs hourly (GitHub Actions `cron.yml`; Vercel Hobby cron is only daily). It notifies subscribers whose sunset is 2–3 h away and scores ≥ `SUNSET_SCORE_MIN`, deduped per day via `lastNotifiedDate`.
- `/api/cron` requires `Authorization: Bearer $CRON_SECRET`; without a secret it's only open in dev.

### Key files

- `src/lib/server/scoring.ts` — `calculateWithDetails()`, `calculateConfidence()`, `evaluate()`, `evaluateInFlight()`; both models share factor helpers with their own coefficients. `WeatherData` lives here.
- `src/lib/server/weather.ts` — Open-Meteo fetches, `nearestIndex()`, `compositeAt()` (weights `[0.3, 0.6, 0.1]` over `[idx-1, idx, idx+1]`), `fetchWithRetry()` (retries 5xx/429 only).
- `src/lib/score.ts` — `scoreLabel()` and `applyScoreTheme()`: one set of score bands (80/65/40) for labels and page theme.
- `src/lib/types.ts` — shared client types and `toClientPrediction()`.

## Important quirks

- Open-Meteo `timeformat=unixtime` values are **UTC epochs**. Compare them to UTC instants directly; never add `utc_offset_seconds` (only use it to format local wall-clock times).
- AOD is only available from the air-quality API, not the forecast API.
- Flight times without an offset are wall-clock times local to each airport. The zone comes from coordinates (`@photostructure/tz-lookup`) because `airports.json` has no zone data. The arrival date is resolved as the first matching local time after departure (flights < 24 h).
- Flight weather is only available up to 16 days ahead; beyond that the response has no score but still has the seat side.
- `predictSunset()` is shared by the API route, the deep-link load and the cron, so changes affect alerts too.
- Additive bonuses apply after the multiplicative low-cloud gate, so a fully overcast but otherwise ideal evening still scores ~30 (rated Poor).

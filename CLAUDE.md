# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # start dev server at http://localhost:5173
npm run build        # production build
npm run preview      # preview production build
npm run typecheck    # svelte-check (TypeScript)
npm run lint         # ESLint (correctness rules; runs in CI)
npm test             # vitest (server logic: scoring, weather, flight, prediction)
npm run db:generate  # drizzle-kit: generate SQL migration from schema
npm run db:push      # drizzle-kit: push schema to the database
```

Weather and geocoding APIs are public. Push alerts need `DATABASE_URL` (Neon), VAPID keys and `CRON_SECRET`; finding flights by number/route needs `AIRLABS_API_KEY`. See `.env.example`.

Environment variables must be declared in `src/env.ts` (`defineEnvVars`); SvelteKit 3 only exposes declared ones. Server code reads them via `import * as env from '$app/env/private'` (`$app/env/public` for `PUBLIC_*`); tests mock that module with `mockEnv()` from `src/lib/server/test-env.ts`.

## Architecture

Sunglow is a SvelteKit 3 app (Svelte 5, runes, Vite 8) that predicts sunset and sunrise quality for a location, and sunset quality during a flight. It's deployed to Vercel with `@sveltejs/adapter-vercel` on Node.js 24.x; kit config lives in `vite.config.js` (there is no `svelte.config.js`). Imports use `#lib/…` with file extensions (`package.json` `imports`), not `$lib`.

### Location prediction

1. `LocationInput.svelte` (city search via `/api/geocode`, or geolocation, named via `src/lib/reverse-geocode.ts` in the browser: Open-Meteo has no reverse endpoint) → `+page.svelte` POSTs coordinates plus `event` (`'sunset' | 'sunrise'`, from the Sunset/Sunrise switch) to `/api/predict`.
2. `predictEvent()` in `src/lib/server/prediction.ts`:
   - `nextEvent()` picks the next sunrise/sunset that isn't over yet (grace: 30 min after sunset, 15 min after sunrise). It checks SunCalc for yesterday/today/tomorrow because SunCalc's "nearest solar day" can return a passed event after local midnight or at high latitudes. `day` compares **local dates** (zone via `timeZoneAt()`), so 01:00 gives "this morning's sunrise".
   - Fetches the hourly forecast and air quality (AOD, PM2.5) via `src/lib/server/weather.ts`, plus cloud cover 50/150/300 km toward the sun at the event via `src/lib/server/horizon.ts` (one multi-point request), all in parallel.
   - Selects the hour nearest the event, builds a weighted composite, scores it with `evaluate()` (same model for both events).
   - Returns `event`, score, confidence, factor details, `day`, and `timings.eventEpochSec` / `goldenHourEpochSec` (golden hour start for sunset, end for sunrise).
   - Coordinates are rounded to 2 decimals (`roundCoord()`) first; results are cached in memory by (lat/lon, event, event hour), checked before any upstream call.
3. Deep links `/?lat=&lon=&label=&event=` are rendered by `+page.server.ts`, which calls `predictEvent()` directly.
4. User-facing per-event wording lives in `src/lib/events.ts` (`EVENT_COPY`); don't hard-code "sunset" in components.

### Flight prediction

`/api/predict-flight`: resolves times (`flight-time.ts`), interpolates the great-circle route, finds waypoints within 60 min of a local sunrise or sunset and groups consecutive ones into sightings (`findEventWindows()` / `bestWaypointPerSighting()` in `flight-route.ts`), then scores each sighting's best waypoint with `evaluateInFlight()` and picks the seat side from sun azimuth vs. heading (`'either'` within 20° of nose or tail). Responds with `sightings[]` in time order. The form finds flights via `/api/flight-schedules` (`src/lib/server/airlabs.ts`: AirLabs `/v9/routes` timetable, codeshares folded into the operating flight, filtered by weekday, cached 24 h). Flight numbers go through `parseFlightNumber()` (`src/lib/flight-number.ts`): IATA (`UA0108` → `UA108`) or ICAO (`UAL0108` → `UAL108`, sent as `flight_icao`), since AirLabs only matches the canonical form. Free AirLabs keys return at most 50 rows, sorted by airline code, and can't page (`offset` returns nothing), so busy routes come back cut short (`incomplete`). `fetchSchedules()` then fetches up to `MAX_EXPANSIONS` airlines that the page's codeshares point to (`hiddenCarriers()`), each with an `airline_iata` filter, which returns that airline's complete list. Route search takes an optional `airline` (picker backed by `/api/airlines`, `src/lib/server/airlines.ts`, data in `src/lib/data/airlines.json` generated from Wikidata by `node scripts/build-airlines.mjs`). Tests use the recorded fixtures in `src/lib/server/__fixtures__/`, never live calls. Airports come from `src/lib/server/airports.ts` (server-only; the client searches via `/api/airports?q=`).

### Push alerts

- `PushSubscribeButton.svelte` subscribes via `src/service-worker/index.ts` and POSTs to `/api/push/subscribe` with `events: { sunset, sunrise }` (Neon via Drizzle, `src/lib/server/db/`); its checkboxes call `/api/push/preferences`, which only changes the flags. Re-subscribing clears dedup dates only if the location changed.
- `/api/cron` runs hourly via a cron-job.org job (Vercel Hobby cron is only daily; GitHub Actions schedules ran hours late, so `cron.yml` is manual-only now). Logic lives in `src/lib/server/alerts.ts`:
  - `alertsDue()` (pure) returns due kinds: `sunset` (2–3 h before), `sunrise-evening` (20:00–23:00 local, tomorrow's sunrise), `sunrise-morning` (1–2 h before). Events come from `nextEvent()`; dedup keys are the event's local date in `lastNotifiedDate` / `lastSunriseEveningDate` / `lastSunriseMorningDate`.
  - `runAlerts()` predicts, then **claims** the alert (`UPDATE … WHERE col IS DISTINCT FROM key RETURNING`) before sending, so overlapping runs can't double-send; below-threshold results are claimed too, failed sends are released for retry.
- `/api/cron` requires `Authorization: Bearer $CRON_SECRET`; without a secret it's only open in dev.
- `sendPush()` sets `TTL` (until 30 min after the event), `urgency: 'high'` and a 5 s timeout. It prunes subscriptions on 404/410/400 and on web-push key-validation errors, but **not** on 403 (usually our VAPID config) or 413 (our payload).
- `/api/cron` returns 500 when any alert failed, so cron-job.org reports it; errors are logged with `console.error`.

### Ratings

- `/api/predict` and the deep-link load attach a `ratingToken` (`src/lib/server/ratings.ts`): an HMAC-signed snapshot of the prediction (event, inputs, score, confidence, `SCORING_VERSION`). Requires `RATING_SECRET` + `DATABASE_URL`, otherwise ratings are off.
- `RatingPrompt.svelte` + `src/lib/rating-store.ts` (localStorage) ask for a 1–5 rating from 15 min before until 24 h after a viewed sunrise/sunset; `POST /api/ratings` verifies the token and upserts into `sunset_ratings` (despite the name, it holds both events: see `event`; `sunset_at` is the event time).
- Token and stored-item readers accept the pre-sunrise format (no `event`, `sunsetEpochSec`) for backwards compatibility.

### Database migrations

Generate with `npm run db:generate`; apply each new `drizzle/000N_*.sql` to Neon **before** deploying code that uses it (Drizzle selects all schema columns by name). Never run `drizzle-kit migrate`: there is no migrations table, so it would re-run `0000`.

### Key files

- `src/lib/server/scoring.ts` — `SCORING_VERSION` (bump on any change that alters scores, so stored ratings can be grouped by model), `calculateWithDetails()`, `calculateConfidence()`, `evaluate()`, `evaluateInFlight()`; both models share factor helpers with their own coefficients. `WeatherData` lives here.
- `src/lib/server/horizon.ts` — sunset azimuth, great-circle sample points, `horizonBlocking()` (low + 0.5 × mid cloud, weighted 0.25/0.4/0.35). Feeds `horizonCloud` into the ground model only; a failed fetch just leaves it out.
- `src/lib/server/validate.ts` — `parseLatLon()` (finite, |lat| ≤ 90, |lon| ≤ 180: out-of-range values crash `tz-lookup`), `cleanLabel()`, `validPushKeys()`. Use these for any new route input.
- `src/lib/server/bounded-cache.ts` — TTL + size-capped in-memory cache used by the prediction and flight endpoints.
- `src/lib/server/weather.ts` — Open-Meteo fetches, `nearestIndex()`, `compositeAt()` (weights `[0.3, 0.6, 0.1]` over `[idx-1, idx, idx+1]`), `fetchWithRetry()` (retries 5xx/429 only).
- `src/lib/score.ts` — `scoreLabel()`, `applyScoreTheme()` / `resetScoreTheme()`: one set of score bands (80/65/40) for labels and page theme. Each theme sets `--surface`, `--surface-strong`, `--border`, `--placeholder`, `--error` and `color-scheme`; components use these variables instead of fixed colors. `score.test.ts` checks WCAG 4.5:1 contrast for every theme, so keep it passing when changing colors.
- `src/lib/explain.ts` — `explainScore()`: the plain-language "Why this score?" text for both models, with each model's own thresholds.
- `src/lib/components/Combobox.svelte` — the one accessible autocomplete (WAI-ARIA combobox: `aria-activedescendant`, always-mounted status). Use it for any new search field.
- UI conventions: inputs stay mounted (hidden) while results show, so "New search"/"Edit flight" keep what was typed; announcements go through the page's always-mounted `role="status"`, errors through its `role="alert"` region with a Retry action.
- `src/lib/types.ts` — shared client types and `toClientPrediction()`.

## Important quirks

- Open-Meteo `timeformat=unixtime` values are **UTC epochs**. Compare them to UTC instants directly; never add `utc_offset_seconds` (only use it to format local wall-clock times).
- AOD is only available from the air-quality API, not the forecast API.
- Flight times without an offset are wall-clock times local to each airport. The zone comes from coordinates (`@photostructure/tz-lookup`) because `airports.json` has no zone data. The arrival date is resolved as the first matching local time after departure (flights < 24 h).
- Flight weather is only available up to 16 days ahead; beyond that the response has no score but still has the seat side.
- `predictEvent()` is shared by the API route, the deep-link load and the cron, so changes affect alerts too.
- Scoring v2 (ground): `(45 clear-sky base + 45 × cloud canvas) × light`, where light = low-cloud multiplier × horizon factor. Bonuses are small and scaled by the same light gates; penalties are not. Keep `scoring-scenarios.test.ts` (reference skies → labels) passing, and bump `SCORING_VERSION` for any change that moves scores.

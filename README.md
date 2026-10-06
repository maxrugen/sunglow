## Sunglow

Sunset and sunrise quality prediction web app built with SvelteKit and TypeScript. It estimates how good the next sunset or sunrise will be for a given location using weather data, solar geometry, and a heuristic scoring model. It can also predict whether you'll see a sunrise or sunset during a flight and which side of the plane to sit on.

### Features
- Predicts **sunset or sunrise** quality (switch in Location mode) with a confidence score and human‑readable explanation
- **In‑flight sunrise/sunset prediction**: enter departure/arrival airports and times to find out if you'll catch a sunrise or sunset mid‑flight, which side of the plane to sit on, and how good it will be
- Airport search across 5,469 worldwide airports (IATA code, city, or name)
- Find your flight by **number** (e.g. UA2410) or by **route** (from, to, date) via AirLabs timetables, so no times need typing; manual entry stays as a fallback
- Great‑circle route interpolation with sunrise/sunset window detection along the flight path (a very long flight can show several)
- Seat side recommendation based on sun azimuth vs. plane heading ("either side" when the sun is within 20° of the nose or tail)
- Adapted in‑flight scoring model (cloud‑top views as bonus, reduced surface penalties)
- Uses the actual sunrise/sunset time (SunCalc) to pick the forecast hour; once today's event has passed (+30 min for sunset, +15 min for sunrise) it switches to tomorrow's
- **Sunset alerts**: opt‑in Web Push notification ~2 hours before a great sunset at your saved location
- Serverless API using Open‑Meteo (hourly weather + air quality for aerosols/PM2.5)
- In‑memory caching keyed by (lat, lon rounded to ~1 km, event, event hour)
- Robust fetches with short timeouts and retries
- Accessible, keyboard‑friendly search with debounced queries and aria‑live announcements
- Dynamic theming based on score using CSS custom properties
- TypeScript across routes and components (Svelte 5 runes); shared types

### Tech stack
- SvelteKit 3 (Svelte 5) + Vite 8, deployed on Vercel
- TypeScript
- SunCalc
- Open‑Meteo (Weather + Geocoding) and BigDataCloud (reverse geocoding, called from the browser)
- Plain CSS with CSS Custom Properties; Inter is self‑hosted via `@fontsource-variable/inter` (no Google Fonts request)
- Neon Postgres + Drizzle (push subscriptions), Web Push (VAPID)

---

## Quick start

### Prerequisites
- Node.js 24+

### Install & run
```bash
npm install
npm run dev
# open http://localhost:5173
```

### Build & preview
```bash
npm run build
npm run preview
```

### Type checking
```bash
npm run typecheck
```

No API keys are required for basic usage; all weather and geocoding APIs are public endpoints.

To find flights by number or route in Flight mode, add an AirLabs key (free plan: 1,000 requests a month) to `.env.local`:
```bash
AIRLABS_API_KEY=your_key_here
```
Without it, manual airport entry still works; the lookup section is simply hidden.

### Running tests
```bash
npm test          # run all tests once
npm run lint      # ESLint
npm run test:watch # watch mode
```

---

## How it works

### High‑level flow

#### Location mode
1) User enters a city or uses "Use My Location".
2) The app reverse geocodes to a label if needed, then POSTs coordinates to the prediction API.
3) The server:
   - Fetches hourly weather, air quality (AOD, PM2.5) and cloud cover along the sunset direction from Open‑Meteo in parallel
   - Picks the hour closest to the actual sunset (all timestamps are UTC epochs)
   - Computes score and confidence using `evaluate` in `src/lib/server/scoring.ts`
   - Caches the response in memory keyed by `(lat,lon,date,hour)`
4) The server also returns the sunset and golden‑hour times (and whether it scored tonight or tomorrow); the client renders them.

#### Flight mode
1) User switches to the "Flight" tab and finds the flight by **number + date** (one match predicts straight away) or **route + date** (pick from that day's flights). Times come from the airline timetable; "Enter times" is the manual fallback.
2) The app POSTs `{ depIata, arrIata, depTime, arrTime }` to `/api/predict-flight`.
3) The server:
   - Looks up airports from a static database of 5,469 worldwide airports
   - Interpolates the great‑circle route at 15‑minute intervals using spherical linear interpolation (Slerp)
   - At each waypoint, computes local sunrise and sunset via SunCalc and keeps waypoints within 60 minutes of one
   - Groups consecutive matches into sightings and picks each one's best waypoint (closest to the event), then fetches weather there from Open‑Meteo
   - Scores using `evaluateInFlight` — an adapted model where low clouds are a bonus (cloud‑top views), PM2.5 is ignored, and surface penalties are reduced
   - Computes which side of the plane faces the sun (sun azimuth vs. plane heading)
4) The client shows one section per sighting: score, seat recommendation, time, plane position, confidence and an explanation, plus a summary when sunrise and sunset are on different sides.

### Scoring model
Core logic lives in:
`src/lib/server/scoring.ts`

- `WeatherData` type describes inputs (cloud layers, humidity, AOD, PM2.5, visibility, wind, pressure trend, dewpoint spread, solar altitude, etc.)
- `calculateWithDetails(weatherData)` (model v2, `SCORING_VERSION = 2`) computes:
  - **Sky:** a clear‑sky base of 45 plus up to 45 for the cloud "canvas" (high cloud best at 40–70%, mid cloud best at 20–50%; a solid sheet or thick mid deck counts less). A clear sky lands around 50 ("Fair"); only a lit canvas reaches "Great".
  - **Light gates, multiplying everything:** low cloud overhead (fades from 25%, near zero above 80%) and the horizon toward the sun: low cloud plus half of mid cloud sampled 50/150/300 km along the sun's azimuth (`src/lib/server/horizon.ts`, weights 0.1/0.45/0.45), from ×1 when clear down to ×0.35 when blocked. Ground model only.
  - Small bonuses (aerosols peaking at AOD 0.3, PM2.5, sun angle, wind, pressure, dew point; about +10 in total), scaled by the light gates
  - Penalties applied in full: humidity, precipitation, visibility, heavy smoke (AOD > 0.5), total overcast
- `calculateConfidence(weatherData, alignedToEvent, leadHours)` factors POP/precip, low clouds, visibility, particulates, whether data was aligned to the real event, and how far ahead the event is (−1 per 3 h, at most −15)
- `evaluateInFlight(weatherData, alignedToEvent)` adapts the model for cruise altitude (~10 km):
  - Clear‑sky base 50; only high cloud is the canvas (mid cloud below the plane adds a little texture)
  - Low clouds are a small bonus (cloud‑top carpet)
  - PM2.5 is ignored (irrelevant at altitude)
  - Humidity threshold raised to 80% (less effect at altitude)
  - Visibility and precipitation penalties are reduced
  - Confidence baseline is 80 (vs. 90) since forecasts are surface‑level
- `evaluate(weatherData, alignedToEvent, leadHours)` returns `{ score, details, confidence }`
- `src/lib/server/scoring-scenarios.test.ts` pins the label of reference skies (clear, canvas, blocked horizon, overcast, rain, smoke). Changing the model means updating those expectations deliberately and bumping `SCORING_VERSION`.

### API endpoints

#### Predict
`POST /api/predict`

Request body:
```json
{ "latitude": number, "longitude": number, "event": "sunset" | "sunrise" }
```
`event` is optional and defaults to `"sunset"`. Deep links accept the same: `/?lat=…&lon=…&label=…&event=sunrise`.

Response (shape abbreviated):
```json
{
  "event": "sunset",
  "qualityScore": 0-100,
  "confidence": 0-100,
  "explanation": { "factors": { /* human-readable factor details */ } },
  "day": "today", // local date of the event: "today" or "tomorrow"
  "timings": { "eventEpochSec": 1730003000, "goldenHourEpochSec": 1730000400 }, // golden hour start (sunset) or end (sunrise)
  "used": {
    "epochSec": 1730000000, // UTC epoch of the scored hour
    "latitude": 52.52,
    "longitude": 13.405
  }
}
```

Notes:
- Uses `timeformat=unixtime`; these timestamps are UTC epochs, so the hour nearest the UTC sunset instant is selected.
- Coordinates are rounded to 2 decimals (~1 km) before predicting, so nearby requests share work. Responses are cached in memory (10 min, size-capped), checked before any upstream fetch. Cache key: `(lat, lon, event, event hour)`.
- Adds `Cache-Control: public, max-age=120` to responses.
- Retries external fetches with short timeouts (server errors and rate limits only).

#### Geocoding
`GET /api/geocode?q=Berlin` → Open‑Meteo Geocoding proxy

#### Reverse Geocoding
"Use My Location" turns coordinates into a place name in the browser via BigDataCloud's free client-side API (`src/lib/reverse-geocode.ts`). Open‑Meteo has no reverse geocoding endpoint.

#### Flight Prediction
`POST /api/predict-flight`

Request body:
```json
{
  "depIata": "MUC",
  "arrIata": "DRS",
  "depTime": "2026-04-12T17:00",
  "arrTime": "2026-04-12T18:00"
}
```

Times without an offset are local wall‑clock times at each airport (as printed on a ticket); the arrival date is resolved to the first matching local time after departure, so overnight flights and date‑line crossings need no special handling. Times with an explicit offset (e.g. `Z`) are used as‑is. Weather is only available up to 16 days ahead; beyond that the response omits `qualityScore` and `confidence` but still includes the seat recommendation.

Response (shape abbreviated):
```json
{
  "sightings": [
    {
      "event": "sunset", // or "sunrise"
      "qualityScore": 81,
      "confidence": 60,
      "seatSide": "left", // "left" | "right" | "either"
      "seatRecommendation": "Sit on the left side of the plane for the best sunset view.",
      "timeUTC": "2026-04-12T18:01:00.000Z",
      "location": "49.1°N, 12.3°E",
      "explanation": { "factors": { } },
      "waypoint": { "offsetMinutes": 4, "sunAzimuth": 284, "planeHeading": 25 }
    }
  ],
  "route": {
    "departure": { "iata": "MUC", "name": "Munich", "lat": 48.35, "lon": 11.79 },
    "arrival": { "iata": "DRS", "name": "Dresden", "lat": 51.13, "lon": 13.77 }
  }
}
```

`sightings` is in time order. If there is no sunrise or sunset during the flight, it is empty and a `message` explains why.

#### Airport Search
`GET /api/airports?q=munich` → up to 8 airports (exact IATA match, then IATA prefix, then city/name substring). Runs server‑side so the airport dataset isn't shipped to the browser.

#### Flight Schedules (optional)
`GET /api/flight-schedules?flight=UA2410&date=2026-10-07` or `?from=IAD&to=SLC&date=2026-10-07` → flights from the AirLabs timetable (`/v9/routes`) that operate on that weekday, with local departure/arrival times, duration and codeshares (folded into the operating flight). Requires `AIRLABS_API_KEY` (501 otherwise); results are cached for 24 h per query, so a search costs at most one AirLabs request a day.

### Frontend components
- `src/lib/components/LocationInput.svelte`
  - Debounced search, keyboard navigation (ArrowUp/Down, Enter), Esc/Click outside to close
  - Announces result count via aria‑live
  - Calls the `onLocationSuccess` / `onLocationError` callback props

- `src/lib/components/ResultsDisplay.svelte`
  - Shows score, qualitative label (Great/Good/Fair/Poor), confidence
  - Shows sunset and golden hour times from the server response, and notes when the forecast is for tomorrow
  - Renders a concise, natural‑language explanation
  - Footer shows used local hour, solar altitude, and coordinates

- `src/lib/components/FlightInput.svelte`
  - Airport search across 5,469 airports (IATA prefix match + city/name substring)
  - Tabs: Flight number, Route (list of that day's flights) and Enter times (manual fallback); the search tabs need `AIRLABS_API_KEY`
  - Flight numbers can be IATA or ICAO and zero-padded (`UA0108`, `UAL0108`); on busy routes the free AirLabs plan (50 rows) cuts the list short: Sunglow fills in airlines it can infer from codeshares, says the list isn't complete, and the optional Airline field gets one airline's complete list
  - Manual tab: date, departure and arrival times, with next‑day handling on the server
  - Keyboard navigation and validation

- `src/lib/components/FlightResultsDisplay.svelte`
  - One section per sunrise/sunset sighting: score, seat side recommendation with icon
  - Displays event time, plane position, confidence, sun azimuth, plane heading
  - Natural‑language explanation of scoring factors
  - Summary line when sightings fall on different sides; "no sunrise or sunset" state

- `src/routes/+page.svelte`
  - Location/Flight mode toggle
  - Wires input → API → results, updates theme by score
  - Clears stale data when switching modes
  - Persists last location in `localStorage` (auto‑load is currently disabled by design)

### Accessibility
- Search results use buttons with `role="option"` and `aria-selected`
- Arrow key navigation for results, Enter to select, Esc/click‑away to close
- aria‑live announcements for result counts and loading/errors

### Performance & robustness
- In‑memory caching by (lat, lon, event, event hour) with short TTL, checked before upstream calls; flight lookups cached for hours
- Short timeouts; retries only for server errors and rate limits
- Airport data and SunCalc stay on the server, keeping the client bundle small
- Service worker (`src/service-worker/`) caches each build's assets and refreshes on deploy
- Response includes `used` time/coords for transparency

---

## Project structure (selected)
```
src/
  lib/
    components/
      LocationInput.svelte        # city/geolocation search
      ResultsDisplay.svelte        # location sunset results
      FlightInput.svelte           # airport search + flight form
      FlightResultsDisplay.svelte  # flight sunrise/sunset results
      PushSubscribeButton.svelte   # opt-in sunset alerts
    data/
      airports.json                # 5,469 airports (OurAirports)
      airlines.json                # ~900 airlines (Wikidata, scripts/build-airlines.mjs)
    server/
      scoring.ts                   # scoring + confidence + evaluate + evaluateInFlight
      weather.ts                   # Open-Meteo fetches, hour selection, weighted composites
      prediction.ts                # location prediction (shared by API, deep links, cron)
      airports.ts                  # airport lookup + search
      horizon.ts                   # cloud sampling toward the setting sun
      flight-route.ts              # great-circle interpolation, sunrise/sunset windows, seat side
      flight-time.ts               # airport-local times -> UTC
      webpush.ts, push-auth.ts     # Web Push sending + subscribe gate
      db/                          # Drizzle schema + Neon client
      *.test.ts                    # vitest unit tests
    score.ts                       # score labels + page theme
    http.ts                        # error message helper
    types.ts                       # client/shared types
  service-worker/index.ts          # asset cache + push handlers
  routes/
    +page.svelte                   # main UI (location + flight modes)
    +page.server.ts                # SSR prefetch (lat/lon/label via query)
    api/
      predict/+server.ts           # location prediction endpoint
      airports/+server.ts          # airport search
      predict-flight/+server.ts    # flight prediction endpoint
      flight-schedules/+server.ts  # AirLabs timetable search (optional)
      geocode/+server.ts           # city → coords proxy
      push/{subscribe,unsubscribe} # store/remove push subscriptions
      ratings/+server.ts           # store "How was it?" ratings
      cron/+server.ts              # hourly sunset-alert job
```

---

## Sunset & sunrise alerts (Web Push)
Optional. New variables must also be declared in `src/env.ts`. Copy `.env.example` to `.env.local` and set `DATABASE_URL`, the VAPID keys and `CRON_SECRET`, then apply the migrations (see [Database migrations](#database-migrations)).

- `/api/push/subscribe` stores the subscription with its location and events (`{ sunset, sunrise }`; the first subscribe uses the event currently shown). `/api/push/preferences` changes the events later without moving the location.
- `/api/cron` (requires `Authorization: Bearer $CRON_SECRET`) sends, when score and confidence meet `SUNSET_SCORE_MIN` / `SUNSET_CONFIDENCE_MIN` (used for both events):
  - **Sunset:** 2–3 hours before sunset (`NOTIFY_LEAD_HOURS`).
  - **Sunrise, evening before:** between 20:00 and 23:00 local (`SUNRISE_EVENING_HOUR`), for tomorrow's sunrise.
  - **Sunrise, morning:** 1–2 hours before sunrise (`SUNRISE_LEAD_HOURS`).
  - Each kind at most once per event. Alerts are claimed in the database before sending, so overlapping runs can't send twice.
  - Pushes expire 30 minutes after the event if the device was offline, so a late phone never shows yesterday's alert. Subscriptions the push service rejects as gone or invalid are deleted.
  - The endpoint returns 500 when any alert failed, so cron-job.org reports the failed run.
- Vercel Hobby crons only run daily, so an hourly job on [cron-job.org](https://cron-job.org) calls the endpoint with the bearer header. GitHub Actions schedules were too unreliable (runs 6–9 h apart). `.github/workflows/cron.yml` remains for manual runs and needs the `APP_URL` and `CRON_SECRET` repository secrets.

---

## Sunset ratings ("How was it?")
Optional, for calibrating the scoring model. Needs `DATABASE_URL` and `RATING_SECRET` plus the `sunset_ratings` table (see [Database migrations](#database-migrations)).

- Each location prediction includes a signed `ratingToken`: a snapshot of the event, weather inputs, score, confidence and `SCORING_VERSION`.
- The browser remembers the last few predictions viewed. From 15 minutes before the sunrise or sunset until 24 hours after, the app asks "How was the sunrise/sunset?" (1–5).
- `POST /api/ratings` verifies the token and stores the rating with the snapshot and its `event`, at most one per device, event and location. Coordinates are rounded to ~1 km; no other personal data is stored. (`sunset_at` holds the time of either event; the names predate sunrise mode.)

## Database migrations
SQL migrations live in `drizzle/` (`npm run db:generate` creates new ones from `src/lib/server/db/schema.ts`). Apply each new file to Neon **before** deploying the code that uses it, either by running its SQL or with `npm run db:push`. Don't use `drizzle-kit migrate`: the database has no migrations table, so it would try to re-run `0000`.

---

## Notes & limitations
- Geolocation requires HTTPS in browsers (secure context). For local testing on mobile, consider a tunnel (e.g., `ngrok`).
- Open‑Meteo coverage/quality can vary by region; PM2.5 and AOD may be missing in some areas.
- The heuristic can be calibrated with real‑world data; weights and thresholds are designed to be adjustable.

---

## Contributing
Issues and PRs welcome. Please run:
```bash
npm test
npm run typecheck
npm run build
```
before submitting.



## Sunglow

Sunset Quality Prediction web app built with SvelteKit and TypeScript. It estimates how good tonight's sunset will be for a given location using weather data, solar geometry, and a heuristic scoring model. It can also predict whether you'll see a sunset during a flight and which side of the plane to sit on.

### Features
- Predicts sunset quality with a confidence score and human‑readable explanation
- **In‑flight sunset prediction**: enter departure/arrival airports and times to find out if you'll catch a sunset mid‑flight, which side of the plane to sit on, and how good it will be
- Airport search across 5,469 worldwide airports (IATA code, city, or name)
- Optional flight number lookup via AviationStack API
- Great‑circle route interpolation with sunset window detection along the flight path
- Seat side recommendation based on sun azimuth vs. plane heading
- Adapted in‑flight scoring model (cloud‑top views as bonus, reduced surface penalties)
- Uses actual sunset time (SunCalc) to pick the forecast hour; after tonight's sunset it switches to tomorrow's
- **Sunset alerts**: opt‑in Web Push notification ~2 hours before a great sunset at your saved location
- Serverless API using Open‑Meteo (hourly weather + air quality for aerosols/PM2.5)
- In‑memory caching keyed by (lat, lon, sunset hour)
- Robust fetches with short timeouts and retries
- Accessible, keyboard‑friendly search with debounced queries and aria‑live announcements
- Dynamic theming based on score using CSS custom properties
- TypeScript across routes and components (Svelte 5 runes); shared types

### Tech stack
- SvelteKit (Svelte 5) + Vite, deployed on Vercel
- TypeScript
- SunCalc
- Open‑Meteo (Weather + Geocoding) and BigDataCloud (fallback reverse geocode)
- Plain CSS with CSS Custom Properties
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

For optional flight number lookup, set your AviationStack API key:
```bash
AVIATIONSTACK_API_KEY=your_key_here npm run dev
```
Without it, manual airport entry still works; the lookup section is simply hidden.

### Running tests
```bash
npm test          # run all tests once
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
1) User switches to the "Flight" tab and enters departure/arrival airports (search by IATA code or city name) plus date and times. Optionally, a flight number can be looked up to auto‑fill these fields.
2) The app POSTs `{ depIata, arrIata, depTime, arrTime }` to `/api/predict-flight`.
3) The server:
   - Looks up airports from a static database of 5,469 worldwide airports
   - Interpolates the great‑circle route at 15‑minute intervals using spherical linear interpolation (Slerp)
   - At each waypoint, computes local sunset time via SunCalc and identifies waypoints within 60 minutes of sunset
   - Picks the best waypoint (closest to actual sunset), fetches weather for that location from Open‑Meteo
   - Scores using `evaluateInFlight` — an adapted model where low clouds are a bonus (cloud‑top views), PM2.5 is ignored, and surface penalties are reduced
   - Computes which side of the plane faces the sun (sun azimuth vs. plane heading)
4) The client displays the score, seat recommendation, sunset time/location, confidence, and an explanation.

### Scoring model
Core logic lives in:
`src/lib/server/scoring.ts`

- `WeatherData` type describes inputs (cloud layers, humidity, AOD, PM2.5, visibility, wind, pressure trend, dewpoint spread, solar altitude, etc.)
- `calculateWithDetails(weatherData)` computes:
  - High/mid cloud bonuses (peak bands)
  - Low cloud multiplicative gate: scales the cloud score and all bonuses (no bonus can add color if the sun is blocked); penalties apply in full
  - Humidity/visibility/haze dampening
  - Precipitation penalties
  - Aerosol/PM2.5 bonus within sensible humidity/visibility ranges
  - Solar altitude band weighting (peak around −3°, effective in [−8°, +2°])
  - Horizon toward the sun: low cloud (plus half of mid cloud) sampled 50/150/300 km along the sunset azimuth (`src/lib/server/horizon.ts`). A clear path gives +4; blocking above 35% costs up to −25. Ground model only.
- `calculateConfidence(weatherData, alignedToSunset)` factors POP/precip, low clouds, visibility, particulates, and whether data was aligned to the real sunset
- `evaluateInFlight(weatherData, alignedToSunset)` adapts the model for cruise altitude (~10 km):
  - Low clouds are inverted to a bonus (cloud‑top canvas)
  - PM2.5 is ignored (irrelevant at altitude)
  - Humidity threshold raised to 80% (less effect at altitude)
  - Visibility and precipitation penalties are reduced
  - Confidence baseline is 80 (vs. 90) since forecasts are surface‑level
- `evaluate(weatherData, alignedToSunset)` returns `{ score, details, confidence }`

### API endpoints

#### Predict
`POST /api/predict`

Request body:
```json
{ "latitude": number, "longitude": number }
```

Response (shape abbreviated):
```json
{
  "qualityScore": 0-100,
  "confidence": 0-100,
  "explanation": { "factors": { /* human-readable factor details */ } },
  "day": "today", // or "tomorrow" once tonight's sunset has passed
  "timings": { "sunsetEpochSec": 1730003000, "goldenHourEpochSec": 1730000400 },
  "used": {
    "epochSec": 1730000000, // UTC epoch of the scored hour
    "latitude": 52.52,
    "longitude": 13.405
  }
}
```

Notes:
- Uses `timeformat=unixtime`; these timestamps are UTC epochs, so the hour nearest the UTC sunset instant is selected.
- Caches responses in memory (`Map`) with TTL, checked before any upstream fetch. Cache key: `(lat,lon,sunset hour)`.
- Adds `Cache-Control: public, max-age=120` to responses.
- Retries external fetches with short timeouts (server errors and rate limits only).

#### Geocoding
`GET /api/geocode?q=Berlin` → Open‑Meteo Geocoding proxy

#### Reverse Geocoding
`GET /api/reverse-geocode?latitude=…&longitude=…` → Open‑Meteo reverse geocode, with BigDataCloud fallback

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
  "sunsetDuringFlight": true,
  "qualityScore": 81,
  "confidence": 60,
  "seatSide": "left",
  "seatRecommendation": "Sit on the left side of the plane for the best sunset view.",
  "sunsetTimeUTC": "2026-04-12T18:01:00.000Z",
  "sunsetLocation": "49.1°N, 12.3°E",
  "explanation": { "factors": { } },
  "route": {
    "departure": { "iata": "MUC", "name": "Munich", "lat": 48.35, "lon": 11.79 },
    "arrival": { "iata": "DRS", "name": "Dresden", "lat": 51.13, "lon": 13.77 }
  }
}
```

If no sunset occurs during the flight, returns `sunsetDuringFlight: false` with a message.

#### Airport Search
`GET /api/airports?q=munich` → up to 8 airports (exact IATA match, then IATA prefix, then city/name substring). Runs server‑side so the airport dataset isn't shipped to the browser.

#### Flight Lookup (optional)
`GET /api/flight-lookup?flight=AA1004&date=2026-04-15` → AviationStack proxy (requires `AVIATIONSTACK_API_KEY` env var; returns 501 when not configured)

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
  - Optional flight number lookup (shown when the server has an AviationStack key)
  - Date, departure time, and arrival time fields with next‑day handling
  - Keyboard navigation and validation

- `src/lib/components/FlightResultsDisplay.svelte`
  - Shows in‑flight sunset score, seat side recommendation with icon
  - Displays sunset time, location, confidence, sun azimuth, plane heading
  - Natural‑language explanation of scoring factors
  - Handles both "sunset during flight" and "no sunset" states

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
- In‑memory caching by (lat, lon, sunset hour) with short TTL, checked before upstream calls
- Short timeouts; retries only for server errors and rate limits
- Airport data and SunCalc stay on the server, keeping the client bundle small
- Service worker (`src/service-worker.ts`) caches each build's assets and refreshes on deploy
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
      FlightResultsDisplay.svelte  # flight sunset results
      PushSubscribeButton.svelte   # opt-in sunset alerts
    data/
      airports.json                # 5,469 airports (OurAirports)
    server/
      scoring.ts                   # scoring + confidence + evaluate + evaluateInFlight
      weather.ts                   # Open-Meteo fetches, hour selection, weighted composites
      prediction.ts                # location prediction (shared by API, deep links, cron)
      airports.ts                  # airport lookup + search
      horizon.ts                   # cloud sampling toward the setting sun
      flight-route.ts              # great-circle interpolation, sunset windows, seat side
      flight-time.ts               # airport-local times -> UTC
      webpush.ts, push-auth.ts     # Web Push sending + subscribe gate
      db/                          # Drizzle schema + Neon client
      *.test.ts                    # vitest unit tests
    score.ts                       # score labels + page theme
    http.ts                        # error message helper
    types.ts                       # client/shared types
  service-worker.ts                # asset cache + push handlers
  routes/
    +page.svelte                   # main UI (location + flight modes)
    +page.server.ts                # SSR prefetch (lat/lon/label via query)
    api/
      predict/+server.ts           # location prediction endpoint
      airports/+server.ts          # airport search
      predict-flight/+server.ts    # flight prediction endpoint
      flight-lookup/+server.ts     # AviationStack proxy (optional)
      geocode/+server.ts           # city → coords proxy
      reverse-geocode/+server.ts   # coords → label proxy (+fallback)
      push/{subscribe,unsubscribe} # store/remove push subscriptions
      ratings/+server.ts           # store "How was it?" ratings
      cron/+server.ts              # hourly sunset-alert job
```

---

## Sunset alerts (Web Push)
Optional. Copy `.env.example` to `.env.local` and set `DATABASE_URL`, the VAPID keys and `CRON_SECRET`, then run `npm run db:push` once.

- `/api/push/subscribe` stores the subscription with its location.
- `/api/cron` (requires `Authorization: Bearer $CRON_SECRET`) checks subscribers whose sunset is 2–3 hours away and sends a notification when the score and confidence meet `SUNSET_SCORE_MIN` / `SUNSET_CONFIDENCE_MIN`. At most one alert per location per day.
- Vercel Hobby crons only run daily, so an hourly job on [cron-job.org](https://cron-job.org) calls the endpoint with the bearer header. GitHub Actions schedules were too unreliable (runs 6–9 h apart). `.github/workflows/cron.yml` remains for manual runs and needs the `APP_URL` and `CRON_SECRET` repository secrets.

---

## Sunset ratings ("How was it?")
Optional, for calibrating the scoring model. Needs `DATABASE_URL` and `RATING_SECRET`; run `npm run db:push` (or apply `drizzle/0001_*.sql`) to create the `sunset_ratings` table.

- Each location prediction includes a signed `ratingToken`: a snapshot of the weather inputs, score, confidence and `SCORING_VERSION`.
- The browser remembers the last few predictions viewed. From 15 minutes before sunset until 24 hours after, the app asks "How was the sunset?" (1–5).
- `POST /api/ratings` verifies the token and stores the rating with the snapshot, at most one per device, sunset and location. Coordinates are rounded to ~1 km; no other personal data is stored.

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



## Sunglow

Sunset Quality Prediction web app built with SvelteKit and TypeScript. It estimates how good tonight's sunset will be for a given location using weather data, solar geometry, and a heuristic scoring model. It can also predict whether you'll see a sunset during a flight and which side of the plane to sit on.

### Features
- Predicts sunset quality with a confidence score and human‑readable explanation- **In‑flight sunset prediction**: enter departure/arrival airports and times to find out if you'll catch a sunset mid‑flight, which side of the plane to sit on, and how good it will be
- Airport search across 5,469 worldwide airports (IATA code, city, or name)
- Optional flight number lookup via AviationStack API
- Great‑circle route interpolation with sunset window detection along the flight path
- Seat side recommendation based on sun azimuth vs. plane heading
- Adapted in‑flight scoring model (cloud‑top views as bonus, reduced surface penalties)- Uses actual sunset time (SunCalc), aligned to the location’s timezone
- Serverless API using Open‑Meteo (hourly weather + optional air quality)
- In‑memory caching keyed by (lat, lon, date, hour)
- Robust fetches with short timeouts and retries
- Accessible, keyboard‑friendly search with debounced queries and aria‑live announcements
- Dynamic theming based on score using CSS custom properties
- TypeScript across routes and components; shared types

### Tech stack
- SvelteKit + Vite
- TypeScript
- SunCalc
- Open‑Meteo (Weather + Geocoding) and BigDataCloud (fallback reverse geocode)
- Plain CSS with CSS Custom Properties

---

## Quick start

### Prerequisites
- Node.js 18+ (or 20+ recommended)

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
   - Fetches hourly weather (unixtime) from Open‑Meteo
   - Derives the correct "used hour" by proximity to the local sunset epoch
   - Optionally fetches PM2.5 (air quality) when relevant
   - Computes score and confidence using `evaluate` in `src/lib/server/scoring.ts`
   - Caches the response in memory keyed by `(lat,lon,date,hour)`
4) The client computes sunset/golden‑hour times with SunCalc and renders results.

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
  - Low cloud multiplicative penalties (gates near the horizon)
  - Humidity/visibility/haze dampening
  - Precipitation penalties
  - Aerosol/PM2.5 bonus within sensible humidity/visibility ranges
  - Solar altitude band weighting (peak around −3°, effective in [−8°, +2°])
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
  "used": {
    "epochSecLocal": 1730000000,
    "latitude": 52.52,
    "longitude": 13.405
  }
}
```

Notes:
- Uses `timeformat=unixtime` to avoid DST/string parsing issues; selects the hourly index nearest local sunset epoch.
- Caches responses in memory (`Map`) with TTL. Cache key includes hour: `(lat,lon,day,hour)`.
- Adds `Cache-Control: public, max-age=120` to responses.
- Retries external fetches with short timeouts.

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
  "depTime": "2026-04-12T17:00:00Z",
  "arrTime": "2026-04-12T18:00:00Z"
}
```

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

#### Flight Lookup (optional)
`GET /api/flight-lookup?flight=AA1004&date=2026-04-15` → AviationStack proxy (requires `AVIATIONSTACK_API_KEY` env var; returns 501 when not configured)

### Frontend components
- `src/lib/components/LocationInput.svelte`
  - Debounced search, keyboard navigation (ArrowUp/Down, Enter), Esc/Click outside to close
  - Announces result count via aria‑live
  - Emits `locationSuccess` and `locationError`

- `src/lib/components/ResultsDisplay.svelte`
  - Shows score, qualitative label (Great/Good/Fair/Poor), confidence
  - Shows sunset and golden hour times (client‑side via SunCalc)
  - Renders a concise, natural‑language explanation
  - Footer shows used local hour, solar altitude, and coordinates

- `src/lib/components/FlightInput.svelte`
  - Airport search across 5,469 airports (IATA prefix match + city/name substring)
  - Optional flight number lookup (auto‑detects availability)
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
- In‑memory caching by (lat, lon, date, hour) with short TTL
- Short timeouts and basic retry for external fetches
- Dynamic import of SunCalc on demand
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
    data/
      airports.json                # 5,469 airports (OurAirports)
    server/
      scoring.ts                   # scoring + confidence + evaluate + evaluateInFlight
      flight-route.ts              # great-circle interpolation, sunset windows, seat side
      flight-route.test.ts         # 25 unit tests
      scoring.test.ts              # 30 unit tests
    types.ts                       # client/shared types
  routes/
    +page.svelte                   # main UI (location + flight modes)
    +page.server.ts                # SSR prefetch (lat/lon/label via query)
    api/
      predict/+server.js           # location prediction endpoint
      predict-flight/+server.ts    # flight prediction endpoint
      flight-lookup/+server.ts     # AviationStack proxy (optional)
      geocode/+server.ts           # city → coords proxy
      reverse-geocode/+server.ts   # coords → label proxy (+fallback)
```

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



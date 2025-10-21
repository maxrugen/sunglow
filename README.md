## Sunglow

Sunset Quality Prediction web app built with SvelteKit and TypeScript. It estimates how good tonight’s sunset will be for a given location using weather data, solar geometry, and a heuristic scoring model.

### Features
- Predicts sunset quality with a confidence score and human‑readable explanation
- Uses actual sunset time (SunCalc), aligned to the location’s timezone
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

No API keys are required; all APIs used are public endpoints.

---

## How it works

### High‑level flow
1) User enters a city or uses “Use My Location”.
2) The app reverse geocodes to a label if needed, then POSTs coordinates to the prediction API.
3) The server:
   - Fetches hourly weather (unixtime) from Open‑Meteo
   - Derives the correct “used hour” by proximity to the local sunset epoch
   - Optionally fetches PM2.5 (air quality) when relevant
   - Computes score and confidence using `evaluate` in `src/lib/server/scoring.ts`
   - Caches the response in memory keyed by `(lat,lon,date,hour)`
4) The client computes sunset/golden‑hour times with SunCalc and renders results.

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

- `src/routes/+page.svelte`
  - Wires input → API → results, updates theme by score
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
      LocationInput.svelte
      ResultsDisplay.svelte
    server/
      scoring.ts                 # scoring + confidence + evaluate
    types.ts                     # client/shared types
  routes/
    +page.svelte                 # main UI
    +page.server.ts              # SSR prefetch (lat/lon/label via query)
    api/
      predict/+server.js         # prediction endpoint (serverless)
      geocode/+server.ts         # city → coords proxy
      reverse-geocode/+server.ts # coords → label proxy (+fallback)
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
npm run typecheck
npm run build
```
before submitting.



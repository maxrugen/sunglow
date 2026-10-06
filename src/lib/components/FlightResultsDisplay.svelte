<script lang="ts">
    import type { FlightPredictionResponse, FlightSighting } from '$lib/types';
    import { scoreLabel } from '$lib/score';
    import { EVENT_COPY } from '$lib/events';

    interface Props {
        prediction?: FlightPredictionResponse | null;
        onBack: () => void;
    }

    let { prediction = null, onBack }: Props = $props();

    let sightings = $derived(prediction?.sightings ?? []);
    // When sunrise and sunset fall on different sides, say so up front.
    let sideSummary = $derived.by(() => {
        const sided = sightings.filter((s) => s.seatSide !== 'either');
        if (sided.length < 2 || new Set(sided.map((s) => s.seatSide)).size < 2) return '';
        return sided.map((s) => `${s.seatSide === 'left' ? 'Left' : 'Right'} side for the ${s.event}`).join(', ') + '.';
    });

    function formatUTCTime(isoStr: string | undefined) {
        if (!isoStr) return '--';
        try {
            return new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(isoStr));
        } catch {
            return '--';
        }
    }

    function buildExplanation(s: FlightSighting) {
        const fx: any = s.explanation?.factors;
        if (!fx) return '';
        const noun = EVENT_COPY[s.event].noun;
        const score = s.qualityScore ?? 0;

        const parts: string[] = [];
        // Low cloud (inverted for flight)
        if (fx.lowCloud?.adjustment > 0) {
            parts.push(`Low clouds below the plane create a cloud-top canvas for the ${noun}.`);
        }
        // High clouds
        if (fx.highCloud) {
            const hc = fx.highCloud.value;
            if (hc >= 40 && hc <= 80) parts.push('High clouds at cruise altitude provide a colorful reflective canvas.');
            else if (hc < 20) parts.push('Few high clouds reduces reflective color.');
        }
        // Mid clouds
        if (fx.midCloud) {
            const mc = fx.midCloud.value;
            if (mc >= 25 && mc <= 55) parts.push('Mid-level clouds add texture and depth.');
        }
        // Humidity
        if (fx.humidity?.value > 80) parts.push('High surface humidity may mean hazier skies.');
        // Precipitation
        if (fx.precipitation) {
            const prob = fx.precipitation.probability ?? 0;
            const rate = fx.precipitation.rateMmH ?? 0;
            if (prob > 50 || rate > 0.5) parts.push('Rain below may partially obscure the horizon view.');
        }
        // Visibility
        if (fx.visibility?.meters && fx.visibility.meters < 3000) parts.push('Low surface visibility suggests hazy conditions.');
        // Aerosol
        if (fx.aod?.value > 0.15 && fx.aod?.value < 0.4 && fx.aod?.bonus > 0) parts.push(`Moderate aerosols can enhance ${noun} vibrancy.`);
        // Pressure
        if (fx.pressureTrend?.hPa > 1) parts.push('Rising pressure hints at clearing skies.');

        if (parts.length === 0) {
            if (score >= 80) return `Conditions look excellent for a stunning in-flight ${noun}.`;
            if (score >= 65) return 'Good conditions for color from the window seat.';
            if (score >= 40) return 'Moderate conditions — some color possible.';
            return `Conditions may limit the ${noun} view from the plane.`;
        }
        return parts.join(' ');
    }
</script>

<section class="card">
    {#if prediction?.route}
        <p class="route">
            <strong>{prediction.route.departure.iata}</strong> → <strong>{prediction.route.arrival.iata}</strong>
        </p>
    {/if}

    {#if sightings.length === 0}
        <h2>No Sunrise or Sunset During This Flight</h2>
        <p class="message">{prediction?.message || 'The sun neither rises nor sets during this flight.'}</p>
    {:else}
        {#if sideSummary}
            <p class="side-summary">{sideSummary}</p>
        {/if}

        {#each sightings as s (s.timeUTC + s.event)}
            {@const copy = EVENT_COPY[s.event]}
            <div class="sighting">
                {#if s.qualityScore != null}
                    <h2>
                        In-Flight {copy.title}: <span class="accent">{s.qualityScore}%</span>
                        <small class="badge">{scoreLabel(s.qualityScore)}</small>
                    </h2>
                {:else}
                    <h2>{copy.title} During Your Flight</h2>
                    <p class="message">No weather forecast is available for this date yet, so there is no quality score. The seat recommendation is still valid.</p>
                {/if}

                <div class="highlight">
                    <div class="seat-rec">
                        <span class="seat-icon" aria-hidden="true">{s.seatSide === 'left' ? '◀' : s.seatSide === 'right' ? '▶' : '▲'}</span>
                        <div>
                            <strong>{s.seatSide === 'either' ? 'Either side works' : `Sit on the ${s.seatSide} side`}</strong>
                            <small>{s.seatRecommendation}</small>
                        </div>
                    </div>
                </div>

                <div class="metrics">
                    <div class="row">
                        <span>{copy.title} time</span>
                        <strong>{formatUTCTime(s.timeUTC)}</strong>
                    </div>
                    <div class="row">
                        <span>Plane position</span>
                        <strong>{s.location}</strong>
                    </div>
                    {#if s.confidence !== undefined}
                        <div class="row">
                            <span>Confidence</span>
                            <strong>{s.confidence}%</strong>
                        </div>
                    {/if}
                    <div class="row">
                        <span>Time offset</span>
                        <strong>{s.waypoint.offsetMinutes} min from {copy.noun}</strong>
                    </div>
                    <div class="row">
                        <span>Sun azimuth</span>
                        <strong>{s.waypoint.sunAzimuth}°</strong>
                    </div>
                    <div class="row">
                        <span>Plane heading</span>
                        <strong>{s.waypoint.planeHeading}°</strong>
                    </div>
                </div>

                {#if s.explanation?.factors}
                    <div class="explain">
                        <h3>Why this score?</h3>
                        <p>{buildExplanation(s)}</p>
                    </div>
                {/if}
            </div>
        {/each}
        <p class="note">Note: Weather data is based on surface-level forecasts. Actual conditions at cruise altitude may differ.</p>
    {/if}

    <button class="btn back-btn" onclick={onBack}>
        ← New prediction
    </button>
</section>

<style>
    .card {
        width: 100%;
        max-width: 640px;
        padding: 1.25rem 1.25rem 1rem;
        border-radius: 16px;
        background: rgba(0,0,0,0.18);
        border: 1px solid rgba(255,255,255,0.18);
        box-shadow: 0 10px 30px rgba(0,0,0,0.25);
        backdrop-filter: blur(12px);
        color: var(--text-primary);
    }
    h2 { margin: 0 0 0.75rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .accent { color: var(--text-accent); }
    .badge { font-size: 0.9rem; padding: 0.25rem 0.5rem; border-radius: 999px; border: 1px solid currentColor; opacity: 0.9; }
    .route { margin: 0 0 0.75rem; font-size: 1.1rem; opacity: 0.95; }
    .side-summary { margin: 0 0 0.75rem; font-weight: 600; color: var(--text-accent); }
    .sighting + .sighting { margin-top: 1.25rem; padding-top: 1.25rem; border-top: 1px solid rgba(255,255,255,0.18); }
    .highlight { margin-bottom: 1rem; }
    .seat-rec {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        border-radius: 12px;
        background: rgba(255,255,255,0.08);
        border: 1px solid var(--text-accent);
    }
    .seat-icon { font-size: 1.5rem; }
    .seat-rec strong { display: block; font-size: 1.05rem; color: var(--text-accent); }
    .seat-rec small { opacity: 0.8; font-size: 0.9rem; }
    .metrics { display: grid; gap: 0.6rem; }
    .row { display: flex; align-items: center; justify-content: space-between; }
    .row strong { font-weight: 600; }
    .message { opacity: 0.9; margin: 0.5rem 0; }
    .explain { margin-top: 1rem; opacity: 0.95; }
    .explain h3 { margin: 0 0 0.5rem; font-size: 1rem; }
    .note { font-size: 0.85rem; opacity: 0.7; margin: 1rem 0 0; font-style: italic; }
    .back-btn {
        margin-top: 1rem;
        width: 100%;
        background: transparent;
        border: 1px solid rgba(255,255,255,0.2);
        color: var(--text-primary);
        padding: 0.6rem;
        border-radius: 10px;
        cursor: pointer;
        font-size: 0.95rem;
    }
    .back-btn:hover { background: rgba(255,255,255,0.08); }
    .btn { transition: transform 0.15s ease, background 0.2s ease; }
</style>

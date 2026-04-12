<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import type { FlightPredictionResponse } from '$lib/types';

    export let prediction: FlightPredictionResponse | null = null;

    const dispatch = createEventDispatcher<{ back: void }>();

    $: score = Number(prediction?.qualityScore ?? 0);
    $: description = score >= 80 ? 'Great' : score >= 65 ? 'Good' : score >= 40 ? 'Fair' : 'Poor';

    function formatUTCTime(isoStr: string | undefined) {
        if (!isoStr) return '--';
        try {
            return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(isoStr));
        } catch {
            return '--';
        }
    }

    function buildExplanation(p: FlightPredictionResponse) {
        const fx: any = p?.explanation?.factors;
        if (!fx) return '';

        const parts: string[] = [];
        // Low cloud (inverted for flight)
        if (fx.lowCloud?.adjustment > 0) {
            parts.push('Low clouds below the plane create a beautiful cloud-top sunset canvas.');
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
        if (fx.aod?.value > 0.15 && fx.aod?.value < 0.4 && fx.aod?.bonus > 0) parts.push('Moderate aerosols can enhance sunset vibrancy.');
        // Pressure
        if (fx.pressureTrend?.hPa > 1) parts.push('Rising pressure hints at clearing skies.');

        if (parts.length === 0) {
            if (score >= 80) return 'Conditions look excellent for a stunning in-flight sunset.';
            if (score >= 65) return 'Good conditions for color from the window seat.';
            if (score >= 40) return 'Moderate conditions — some color possible.';
            return 'Conditions may limit the sunset view from the plane.';
        }
        return parts.join(' ');
    }
</script>

<section class="card">
    {#if prediction && prediction.sunsetDuringFlight}
        <h2>
            In-Flight Sunset: <span class="accent">{score}%</span>
            <small class="badge">{description}</small>
        </h2>

        {#if prediction.route}
            <p class="route">
                <strong>{prediction.route.departure.iata}</strong> → <strong>{prediction.route.arrival.iata}</strong>
            </p>
        {/if}

        <div class="highlight">
            <div class="seat-rec">
                <span class="seat-icon">{prediction.seatSide === 'left' ? '◀' : '▶'}</span>
                <div>
                    <strong>Sit on the {prediction.seatSide} side</strong>
                    <small>for the best sunset view</small>
                </div>
            </div>
        </div>

        <div class="metrics">
            <div class="row">
                <span>Sunset time</span>
                <strong>{formatUTCTime(prediction.sunsetTimeUTC)}</strong>
            </div>
            <div class="row">
                <span>Sunset location</span>
                <strong>{prediction.sunsetLocation ?? '--'}</strong>
            </div>
            {#if prediction.confidence !== undefined}
                <div class="row">
                    <span>Confidence</span>
                    <strong>{prediction.confidence}%</strong>
                </div>
            {/if}
            {#if prediction.sunsetWaypoint}
                <div class="row">
                    <span>Time offset</span>
                    <strong>{prediction.sunsetWaypoint.offsetMinutes} min from sunset</strong>
                </div>
                <div class="row">
                    <span>Sun azimuth</span>
                    <strong>{prediction.sunsetWaypoint.sunAzimuth}°</strong>
                </div>
                <div class="row">
                    <span>Plane heading</span>
                    <strong>{prediction.sunsetWaypoint.planeHeading}°</strong>
                </div>
            {/if}
        </div>

        {#if prediction.explanation?.factors}
            <div class="explain">
                <h3>Why this score?</h3>
                <p>{buildExplanation(prediction)}</p>
                <p class="note">Note: Weather data is based on surface-level forecasts. Actual conditions at cruise altitude may differ.</p>
            </div>
        {/if}

    {:else if prediction}
        <h2>No Sunset During Flight</h2>
        {#if prediction.route}
            <p class="route">
                <strong>{prediction.route.departure.iata}</strong> → <strong>{prediction.route.arrival.iata}</strong>
            </p>
        {/if}
        <p class="message">{prediction.message || 'The sun does not set during this flight.'}</p>
    {/if}

    <button class="btn back-btn" on:click={() => dispatch('back')}>
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
    .note { font-size: 0.85rem; opacity: 0.7; margin: 0.5rem 0 0; font-style: italic; }
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

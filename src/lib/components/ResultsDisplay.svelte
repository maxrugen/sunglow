<script>
    export let prediction;
    export let locationLabel = '';
    export let confidence = undefined;

    $: score = Number(prediction?.qualityScore ?? 0);
    $: description = score >= 80 ? 'Great' : score >= 65 ? 'Good' : score >= 40 ? 'Fair' : 'Poor';

    function formatTime(value) {
        if (!value) return '--';
        const d = value instanceof Date ? value : new Date(value);
        return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d);
    }

    function buildExplanation(p) {
        const fx = p?.explanation?.factors;
        if (!fx) return '';

        const parts = [];
        // Low cloud gate
        if (fx.lowCloud?.value <= 25) {
            parts.push('Clear low-level skies let the sun light up the higher clouds.');
        } else if (fx.lowCloud?.value > 60) {
            parts.push('Extensive low clouds likely blocked the sun near the horizon.');
        }
        // High clouds canvas
        if (fx.highCloud) {
            const hc = fx.highCloud.value;
            if (hc >= 40 && hc <= 80) parts.push('A healthy amount of high clouds provided a reflective canvas.');
            else if (hc < 20) parts.push('Very few high clouds reduced colorful reflections.');
        }
        // Mid clouds texture
        if (fx.midCloud) {
            const mc = fx.midCloud.value;
            if (mc >= 25 && mc <= 55) parts.push('Mid-level clouds added texture and structure.');
        }
        // Humidity / visibility / haze
        if (fx.humidity?.value > 75) parts.push('High humidity can wash out colors.');
        if (fx.visibility?.meters && fx.visibility.meters < 5000) parts.push('Reduced visibility (haze/fog) may mute contrast.');
        if (fx.dewSpread?.celsius !== undefined) {
            const ds = fx.dewSpread.celsius;
            if (ds < 2) parts.push('Very small temperature–dew point spread suggests hazy conditions.');
        }
        // Precipitation
        if (fx.precipitation) {
            if (fx.precipitation.probability > 50 || (fx.precipitation.rateMmH ?? 0) > 0.2) {
                parts.push('Showers around sunset reduce the chance of vivid skies.');
            }
        }
        // Aerosols
        if (fx.aod?.value) {
            const a = fx.aod.value;
            if (a > 0.15 && a < 0.4) parts.push('Moderate aerosols can enhance vibrancy.');
        }
        if (fx.pm25?.ugm3 !== undefined && fx.pm25.ugm3 > 60) parts.push('Heavy particulates may dull the view.');
        // Wind / pressure
        if (fx.wind?.speedMs !== undefined) {
            const w = fx.wind.speedMs;
            if (w >= 1 && w <= 6) parts.push('A gentle breeze helps keep the lower air clearer.');
        }
        if (fx.pressureTrend?.hPa !== undefined) {
            const pt = fx.pressureTrend.hPa;
            if (pt > 1) parts.push('Rising pressure hints at clearing conditions.');
        }

        // Fall back if empty
        if (parts.length === 0) {
            if (score >= 80) return 'Conditions look excellent for a colorful sunset.';
            if (score >= 65) return 'Conditions are decent for some color near sunset.';
            if (score >= 40) return 'Conditions are marginal; some color is possible.';
            return 'Clouds or haze likely limit a colorful sunset today.';
        }
        return parts.join(' ');
    }
</script>

<section class="card">
    <h2>
        Sunset Quality: <span class="accent">{score}%</span>
        <small class="badge">{description}</small>
    </h2>
    {#if locationLabel}
        <p class="location">{locationLabel}</p>
    {/if}

    <div class="metrics">
        <div class="row">
            <span>Sunset</span>
            <strong>{formatTime(prediction?.timings?.sunset)}</strong>
        </div>
        <div class="row">
            <span>Golden Hour</span>
            <strong>{formatTime(prediction?.timings?.goldenHour)}</strong>
        </div>
        {#if confidence !== undefined}
            <div class="row">
                <span>Confidence</span>
                <strong>{confidence}%</strong>
            </div>
        {/if}
    </div>

    {#if prediction?.explanation?.factors}
        <div class="explain">
            <h3>Why this score?</h3>
            <p>{buildExplanation(prediction)}</p>
            {#if prediction?.used}
                <p class="used">
                    Used time: {new Date((prediction.used.epochSecLocal || 0) * 1000).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}
                    · Solar altitude: {prediction?.explanation?.factors?.solarAltitude?.deg !== undefined ? `${Math.round(prediction.explanation.factors.solarAltitude.deg)}°` : '—'}
                    · Coords: {prediction.used.latitude?.toFixed?.(3)}, {prediction.used.longitude?.toFixed?.(3)}
                </p>
            {/if}
        </div>
    {/if}
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
    h2 { margin: 0 0 1rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem; }
    .accent { color: var(--text-accent); }
    .badge { font-size: 0.9rem; padding: 0.25rem 0.5rem; border-radius: 999px; border: 1px solid currentColor; opacity: 0.9; }
    .metrics { display: grid; gap: 0.75rem; }
    .row { display: flex; align-items: center; justify-content: space-between; }
    .location { margin: 0 0 0.5rem; opacity: 0.9; font-weight: 700; }
    .row strong { font-weight: 600; }
    .explain { margin-top: 1rem; opacity: 0.95; }
    .explain h3 { margin: 0 0 0.5rem; font-size: 1rem; }
    .used { margin: 0.5rem 0 0; font-size: 0.9rem; opacity: 0.9; }
</style>



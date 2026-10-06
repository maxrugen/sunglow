<script lang="ts">
    import type { ClientPrediction } from '$lib/types';
    import { scoreLabel } from '$lib/score';
    import { EVENT_COPY } from '$lib/events';

    interface Props {
        prediction: ClientPrediction | null;
        locationLabel?: string;
    }

    let { prediction, locationLabel = '' }: Props = $props();

    let score = $derived(Number(prediction?.qualityScore ?? 0));
    let description = $derived(scoreLabel(score));
    let confidence = $derived(prediction?.confidence);
    let isTomorrow = $derived(prediction?.day === 'tomorrow');
    let copy = $derived(EVENT_COPY[prediction?.event ?? 'sunset']);

    /**
     * Wall-clock time at the forecast location (not the viewer's zone): shift by
     * the location's UTC offset, then format as UTC.
     */
    function formatTime(value: Date | number | null | undefined) {
        if (value == null) return '--';
        const d = value instanceof Date ? value : new Date(value);
        if (isNaN(d.getTime())) return '--';
        const offsetSec = prediction?.used?.utcOffsetSeconds;
        if (offsetSec == null) {
            return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d);
        }
        return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
            .format(new Date(d.getTime() + offsetSec * 1000));
    }

    function buildExplanation(p: any) {
        const fx = p?.explanation?.factors;
        if (!fx) return '';

        const parts = [];
        // Low cloud gate
        if (fx.lowCloud?.value <= 25) {
            parts.push('Clear low-level skies let the sun light up the higher clouds.');
        } else if (fx.lowCloud?.value > 60) {
            parts.push('Extensive low clouds likely blocked the sun near the horizon.');
        }
        // Clouds toward the rising/setting sun
        // `state` since scoring v2; older payloads only had the sign of `net`.
        const horizonState = fx.horizon?.state ?? (fx.horizon?.net < 0 ? 'blocked' : fx.horizon?.net > 0 ? 'clear' : undefined);
        if (horizonState === 'blocked' || horizonState === 'partial') {
            parts.push(`Clouds toward the ${copy.sunAdjective} sun may block the light before it reaches the sky overhead.`);
        } else if (horizonState === 'clear') {
            parts.push(`The sky toward the ${copy.sunAdjective} sun looks clear, so light can reach the clouds overhead.`);
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
                parts.push(`Showers around ${copy.noun} reduce the chance of vivid skies.`);
            }
        }
        // Aerosols
        if (fx.aod?.value) {
            const a = fx.aod.value;
            if (a > 0.15 && a < 0.4) parts.push('Moderate aerosols can enhance vibrancy.');
            else if (a > 0.5) parts.push('Smoke or dust in the air is likely to mute the colors.');
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
            if (score >= 80) return `Conditions look excellent for a colorful ${copy.noun}.`;
            if (score >= 65) return `Conditions are decent for some color near ${copy.noun}.`;
            if (score >= 40) return 'Conditions are marginal; some color is possible.';
            return `Clouds or haze likely limit a colorful ${copy.noun}.`;
        }
        return parts.join(' ');
    }
</script>

<section class="card">
    <h2 id="result-heading" tabindex="-1">
        {isTomorrow ? `Tomorrow's ${copy.title}` : `${copy.title} Quality`}: <span class="accent">{score}%</span>
        <small class="badge">{description}</small>
    </h2>
    {#if locationLabel}
        <p class="location">{locationLabel}</p>
    {/if}
    {#if isTomorrow}
        <p class="day-note">{copy.dayPassedNote}</p>
    {/if}

    <div class="metrics">
        <div class="row">
            <span>{copy.title}</span>
            <strong>{formatTime(prediction?.timings?.event)}</strong>
        </div>
        <div class="row">
            <span>{copy.goldenHourLabel}</span>
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
                    Used time: {formatTime((prediction.used.epochSec || 0) * 1000)}
                    {#if (() => { const fx:any = prediction?.explanation?.factors as any; return typeof fx?.solarAltitude?.deg === 'number'; })()}
                        · Solar altitude: {(() => { const fx:any = prediction?.explanation?.factors as any; return Math.round(fx.solarAltitude.deg); })()}°
                    {:else}
                        · Solar altitude: —
                    {/if}
                    · Coords: {prediction.used.latitude?.toFixed?.(3)}, {prediction.used.longitude?.toFixed?.(3)}
                </p>
            {/if}
        </div>
    {/if}
</section>

<style>
    h2 { margin: 0 0 1rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem; }
    .accent { color: var(--text-accent); }
    .badge { font-size: 0.9rem; padding: 0.25rem 0.5rem; border-radius: 999px; border: 1px solid currentColor; }
    .metrics { display: grid; gap: 0.75rem; }
    .row { display: flex; align-items: center; justify-content: space-between; }
    .location { margin: 0 0 0.5rem; font-weight: 700; }
    .day-note { margin: 0 0 0.5rem; font-size: 0.85rem; }
    .row strong { font-weight: 600; }
    .explain { margin-top: 1rem; }
    .explain h3 { margin: 0 0 0.5rem; font-size: 1rem; }
    .used { margin: 0.5rem 0 0; font-size: 0.9rem; }
</style>



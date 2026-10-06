<script lang="ts">
    import { explainScore } from '$lib/explain';
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
            <p>{explainScore(prediction.explanation?.factors, score, prediction.event, 'ground')}</p>
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
    .location { margin: 0 0 0.5rem; font-weight: 700; }
    .day-note { margin: 0 0 0.5rem; font-size: 0.85rem; }
    .used { margin: 0.5rem 0 0; font-size: 0.9rem; }
</style>



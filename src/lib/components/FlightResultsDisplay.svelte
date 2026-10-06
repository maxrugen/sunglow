<script lang="ts">
    import { explainScore } from '#lib/explain.js';
    import type { FlightPredictionResponse } from '#lib/types.js';
    import { scoreLabel } from '#lib/score.js';
    import { EVENT_COPY } from '#lib/events.js';

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

    /**
     * The event time where the plane is (matching how Location mode shows
     * times), plus the viewer's own time when that zone differs.
     */
    function formatEventTime(isoStr: string, timeZone?: string): { local: string; yours: string | null } {
        const date = new Date(isoStr);
        const fmt = (zone?: string) =>
            new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: zone }).format(date);
        try {
            const local = fmt(timeZone);
            const yours = fmt();
            return { local, yours: timeZone && yours !== local ? yours : null };
        } catch {
            return { local: fmt(), yours: null };
        }
    }

</script>

<section class="card">
    <h2 id="flight-result-heading" class="route" tabindex="-1">
        {#if prediction?.route}
            {prediction.route.departure.iata} → {prediction.route.arrival.iata}
        {:else}
            Your flight
        {/if}
    </h2>

    {#if sightings.length === 0}
        <h3 class="title">No Sunrise or Sunset During This Flight</h3>
        <p class="message">{prediction?.message || 'The sun neither rises nor sets during this flight.'}</p>
    {:else}
        {#if sideSummary}
            <p class="side-summary">{sideSummary}</p>
        {/if}

        {#each sightings as s (s.timeUTC + s.event)}
            {@const copy = EVENT_COPY[s.event]}
            {@const time = formatEventTime(s.timeUTC, s.timeZone)}
            <div class="sighting">
                {#if s.qualityScore != null}
                    <h3 class="title">
                        In-Flight {copy.title}: <span class="accent">{s.qualityScore}%</span>
                        <small class="badge">{scoreLabel(s.qualityScore)}</small>
                    </h3>
                {:else}
                    <h3 class="title">{copy.title} During Your Flight</h3>
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
                        <strong>
                            {time.local}
                            {#if time.yours}<small class="your-time">{time.yours} your time</small>{/if}
                        </strong>
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
                        <h4>Why this score?</h4>
                        <p>{explainScore(s.explanation?.factors, s.qualityScore ?? 0, s.event, 'flight')}</p>
                    </div>
                {/if}
            </div>
        {/each}
        <p class="note">Note: Weather data is based on surface-level forecasts. Actual conditions at cruise altitude may differ.</p>
    {/if}

    <button class="btn back-btn" type="button" onclick={onBack}>
        ← Edit flight
    </button>
</section>

<style>
    .title { margin: 0 0 0.75rem; font-size: 1.4rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .route { margin: 0 0 0.75rem; font-size: 1.1rem; font-weight: 600; }
    .side-summary { margin: 0 0 0.75rem; font-weight: 600; color: var(--text-accent); }
    .sighting + .sighting { margin-top: 1.25rem; padding-top: 1.25rem; border-top: 1px solid var(--border); }
    .highlight { margin-bottom: 1rem; }
    .seat-rec {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        border-radius: 12px;
        background: var(--surface);
        border: 1px solid var(--text-accent);
    }
    .seat-icon { font-size: 1.5rem; }
    .seat-rec strong { display: block; font-size: 1.05rem; color: var(--text-accent); }
    .seat-rec small { font-size: 0.9rem; }
    .your-time { display: block; font-weight: 400; font-size: 0.8rem; }
    .message { margin: 0.5rem 0; }
    .note { font-size: 0.85rem; margin: 1rem 0 0; font-style: italic; }
    .back-btn {
        margin-top: 1rem;
        width: 100%;
        background: transparent;
        padding: 0.6rem;
        font-size: 0.95rem;
    }
</style>

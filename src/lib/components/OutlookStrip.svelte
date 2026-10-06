<script lang="ts">
    import { scoreLabel } from '#lib/score.js';
    import { EVENT_COPY } from '#lib/events.js';
    import type { SkyEvent } from '#lib/types.js';

    type OutlookDay = { date: string; eventEpochSec: number; qualityScore: number; confidence: number };
    type Outlook = { event: SkyEvent; timeZone: string; days: OutlookDay[] };

    interface Props {
        latitude: number;
        longitude: number;
        event: SkyEvent;
    }

    let { latitude, longitude, event }: Props = $props();

    /** Below this, a day is shown muted (far out, or rain and low cloud make it a guess). */
    const LOW_CONFIDENCE = 60;
    /** A day only counts as "best" if it's at least Fair. */
    const WORTH_HIGHLIGHTING = 40;

    let outlook = $state<Outlook | null>(null);

    // Supplementary to the main result, so it loads afterwards and simply stays hidden on failure.
    $effect(() => {
        const params = new URLSearchParams({ lat: String(latitude), lon: String(longitude), event });
        const controller = new AbortController();
        outlook = null;
        fetch(`/api/outlook?${params.toString()}`, { signal: controller.signal })
            .then((res) => (res.ok ? res.json() : null))
            .then((data: Outlook | null) => {
                if (data?.days?.length) outlook = data;
            })
            .catch(() => {
                // Aborted or offline: the main prediction is still shown.
            });
        return () => controller.abort();
    });

    let best = $derived.by(() => {
        if (!outlook) return null;
        const top = outlook.days.reduce((a, b) => (b.qualityScore > a.qualityScore ? b : a), outlook.days[0]);
        return top.qualityScore >= WORTH_HIGHLIGHTING ? top : null;
    });
    let summary = $derived(
        outlook
            ? `${best ? `Best: ${dayName(best, outlook.timeZone)} (${scoreLabel(best.qualityScore)}).` : `No good ${EVENT_COPY[outlook.event].noun}s in sight.`} Faded days are less certain.`
            : ''
    );

    /** Short weekday in the location's own calendar ("Thu"); fits seven columns on a phone. */
    function dayName(day: OutlookDay, timeZone: string): string {
        return new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone }).format(day.eventEpochSec * 1000);
    }

    function fullDate(day: OutlookDay, timeZone: string): string {
        return new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(
            day.eventEpochSec * 1000
        );
    }

    function localTime(day: OutlookDay, timeZone: string): string {
        return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone }).format(day.eventEpochSec * 1000);
    }

    /** `localTime()` without AM/PM, which is obvious for a sunrise or sunset and too wide for a column. */
    function shortTime(day: OutlookDay, timeZone: string): string {
        return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone })
            .formatToParts(day.eventEpochSec * 1000)
            .filter((part) => part.type === 'hour' || part.type === 'minute' || (part.type === 'literal' && part.value.trim()))
            .map((part) => part.value)
            .join('');
    }
</script>

{#if outlook}
    {@const copy = EVENT_COPY[outlook.event]}
    <section class="card outlook" aria-labelledby="outlook-heading">
        <h3 id="outlook-heading">Next {outlook.days.length} {copy.noun}s</h3>
        <ol class="days">
            {#each outlook.days as day (day.date)}
                {@const uncertain = day.confidence < LOW_CONFIDENCE}
                <li
                    class="day"
                    class:best={day === best}
                    class:uncertain
                    aria-label={`${fullDate(day, outlook.timeZone)}, ${copy.noun} at ${localTime(day, outlook.timeZone)}: ${day.qualityScore} out of 100, ${scoreLabel(day.qualityScore)}${uncertain ? ', uncertain' : ''}${day === best ? ', best of the week' : ''}`}
                >
                    <span class="name" aria-hidden="true">{dayName(day, outlook.timeZone)}</span>
                    <span class="bar" aria-hidden="true"><span class="fill" style:height={`${day.qualityScore}%`}></span></span>
                    <strong class="score" aria-hidden="true">{day.qualityScore}</strong>
                    <small class="time" aria-hidden="true">{shortTime(day, outlook.timeZone)}</small>
                </li>
            {/each}
        </ol>
        <p class="note">{summary}</p>
    </section>
{/if}

<style>
    .outlook h3 { margin: 0 0 0.75rem; font-size: 1rem; }
    .days {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: 0.35rem;
    }
    .day {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
        padding: 0.4rem 0.1rem;
        border-radius: 10px;
        border: 1px solid transparent;
        min-width: 0;
    }
    .day.best { border-color: var(--text-accent); }
    .day.uncertain { opacity: 0.6; }
    .name { font-size: 0.8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .bar {
        position: relative;
        width: 0.6rem;
        height: 3.5rem;
        border-radius: 999px;
        background: var(--border);
        overflow: hidden;
    }
    .fill { position: absolute; inset: auto 0 0 0; background: var(--text-accent); border-radius: 999px; }
    .score { font-size: 0.95rem; }
    .time { font-size: 0.7rem; opacity: 0.85; white-space: nowrap; }
    .note { margin: 0.75rem 0 0; font-size: 0.8rem; opacity: 0.85; }
</style>

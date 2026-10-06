<script lang="ts">
    import type { Airport } from '$lib/types';
    import Combobox from './Combobox.svelte';

    type FlightSubmitDetail = { depIata: string; arrIata: string; depTime: string; arrTime: string };
    type ScheduledFlight = {
        flightIata: string;
        depIata: string;
        arrIata: string;
        depName?: string;
        arrName?: string;
        depTime: string;
        arrTime: string;
        durationMin?: number;
        codeshares: string[];
    };
    type SearchMode = 'number' | 'route' | 'manual';

    interface Props {
        /** Whether the server can search flight timetables (decided in the page load). */
        lookupAvailable?: boolean;
        onFlightSubmit: (flight: FlightSubmitDetail) => void;
        onSwitchMode: () => void;
    }

    let { lookupAvailable = false, onFlightSubmit, onSwitchMode }: Props = $props();

    /** Today's date in the browser's zone as YYYY-MM-DD (toISOString would give the UTC date). */
    function localDateString(d = new Date()): string {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    const MODES: Array<{ id: SearchMode; label: string }> = [
        { id: 'number', label: 'Flight number' },
        { id: 'route', label: 'Route' },
        { id: 'manual', label: 'Enter times' },
    ];
    let mode: SearchMode = $state('manual');
    $effect(() => {
        // Searching needs the server's timetable API; without it only manual entry works.
        mode = lookupAvailable ? 'number' : 'manual';
    });

    // Shared between the tabs, so switching keeps what was entered.
    let flightCode: string = $state('');
    let dateStr: string = $state(localDateString());
    let depSearch: string = $state('');
    let arrSearch: string = $state('');
    let depResults: Airport[] = $state([]);
    let arrResults: Airport[] = $state([]);
    let selectedDep: Airport | null = $state(null);
    let selectedArr: Airport | null = $state(null);
    let depTime: string = $state('');
    let arrTime: string = $state('');

    let isSearching: boolean = $state(false);
    let schedules: ScheduledFlight[] = $state([]);
    let searchMessage: string = $state('');
    let errorMessage: string = $state('');

    const airportLabel = (a: Airport) => `${a.iata} – ${a.name}`;
    const resultsStatus = (n: number) => (n ? `${n} airport${n === 1 ? '' : 's'} found` : '');
    const duration = (min?: number) => (min ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : '');

    // Airport search runs on the server so the dataset stays out of the bundle.
    const searchCache = new Map<string, Airport[]>();
    async function searchAirport(query: string): Promise<Airport[]> {
        const q = query.trim().toUpperCase();
        if (q.length < 2) return [];
        const cached = searchCache.get(q);
        if (cached) return cached;
        try {
            const res = await fetch(`/api/airports?q=${encodeURIComponent(q)}`);
            if (!res.ok) return [];
            const results: Airport[] = (await res.json())?.results ?? [];
            searchCache.set(q, results);
            return results;
        } catch {
            return [];
        }
    }

    let depDebounce: ReturnType<typeof setTimeout>;
    let arrDebounce: ReturnType<typeof setTimeout>;

    function onDepInput(text: string) {
        if (selectedDep && text !== airportLabel(selectedDep)) selectedDep = null;
        clearTimeout(depDebounce);
        depDebounce = setTimeout(async () => {
            const results = await searchAirport(text);
            // Ignore responses for text the user has since changed.
            if (text === depSearch && !selectedDep) depResults = results;
        }, 150);
    }

    function onArrInput(text: string) {
        if (selectedArr && text !== airportLabel(selectedArr)) selectedArr = null;
        clearTimeout(arrDebounce);
        arrDebounce = setTimeout(async () => {
            const results = await searchAirport(text);
            if (text === arrSearch && !selectedArr) arrResults = results;
        }, 150);
    }

    function selectDep(a: Airport) {
        selectedDep = a;
        depSearch = airportLabel(a);
        depResults = [];
    }

    function selectArr(a: Airport) {
        selectedArr = a;
        arrSearch = airportLabel(a);
        arrResults = [];
    }

    function switchTo(next: SearchMode) {
        mode = next;
        errorMessage = '';
        searchMessage = '';
        schedules = [];
    }

    /** Wall-clock times without an offset: the server reads each in its airport's zone. */
    function predict(depIata: string, arrIata: string, dep: string, arr: string) {
        onFlightSubmit({ depIata, arrIata, depTime: `${dateStr}T${dep}:00`, arrTime: `${dateStr}T${arr}:00` });
    }

    async function findFlights(e: SubmitEvent) {
        e.preventDefault();
        errorMessage = '';
        searchMessage = '';
        schedules = [];

        const params = new URLSearchParams({ date: dateStr });
        if (mode === 'number') {
            const code = flightCode.trim().toUpperCase().replace(/\s+/g, '');
            if (!code) { errorMessage = 'Enter a flight number, like UA2410.'; return; }
            params.set('flight', code);
        } else {
            if (!selectedDep) { errorMessage = 'Pick a departure airport.'; return; }
            if (!selectedArr) { errorMessage = 'Pick an arrival airport.'; return; }
            params.set('from', selectedDep.iata);
            params.set('to', selectedArr.iata);
        }
        if (!dateStr) { errorMessage = 'Pick a date.'; return; }

        isSearching = true;
        try {
            const res = await fetch(`/api/flight-schedules?${params.toString()}`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { errorMessage = data.error || 'Flight search failed. Try again, or enter the times.'; return; }
            schedules = data.flights ?? [];
            searchMessage = data.message ?? '';
            // A flight number usually means one flight: go straight to the prediction.
            if (mode === 'number' && schedules.length === 1) {
                const f = schedules[0];
                predict(f.depIata, f.arrIata, f.depTime, f.arrTime);
            }
        } catch {
            errorMessage = "Can't reach Sunglow right now. Check your connection and try again.";
        } finally {
            isSearching = false;
        }
    }

    function submitManual(e: SubmitEvent) {
        e.preventDefault();
        errorMessage = '';
        if (!selectedDep) { errorMessage = 'Select a departure airport.'; return; }
        if (!selectedArr) { errorMessage = 'Select an arrival airport.'; return; }
        if (!depTime) { errorMessage = 'Enter departure time.'; return; }
        if (!arrTime) { errorMessage = 'Enter arrival time.'; return; }
        predict(selectedDep.iata, selectedArr.iata, depTime, arrTime);
    }
</script>

{#snippet airportField(which: 'dep' | 'arr')}
    {#if which === 'dep'}
        <Combobox
            id="dep-input"
            label="From"
            placeholder="City or airport code"
            bind:value={depSearch}
            items={depResults}
            status={resultsStatus(depResults.length)}
            onInput={onDepInput}
            onSelect={selectDep}
        >
            {#snippet option(a)}
                <span><strong class="iata">{a.iata}</strong> {a.name}</span>
                <small>{a.city}, {a.country}</small>
            {/snippet}
        </Combobox>
    {:else}
        <Combobox
            id="arr-input"
            label="To"
            placeholder="City or airport code"
            bind:value={arrSearch}
            items={arrResults}
            status={resultsStatus(arrResults.length)}
            onInput={onArrInput}
            onSelect={selectArr}
        >
            {#snippet option(a)}
                <span><strong class="iata">{a.iata}</strong> {a.name}</span>
                <small>{a.city}, {a.country}</small>
            {/snippet}
        </Combobox>
    {/if}
{/snippet}

{#snippet dateField()}
    <div class="field">
        <label class="field-label" for="flight-date">Date</label>
        <input id="flight-date" type="date" bind:value={dateStr} />
    </div>
{/snippet}

<div class="flight-input">
    {#if lookupAvailable}
        <div class="segmented" role="group" aria-label="How to find your flight">
            {#each MODES as m}
                <button type="button" class:active={mode === m.id} aria-pressed={mode === m.id} onclick={() => switchTo(m.id)}>
                    {m.label}
                </button>
            {/each}
        </div>
    {/if}

    {#if mode === 'manual'}
        <form class="fields" onsubmit={submitManual}>
            {@render airportField('dep')}
            {@render airportField('arr')}
            <div class="time-row">
                {@render dateField()}
                <div class="field">
                    <label class="field-label" for="dep-time">Departure time</label>
                    <input id="dep-time" type="time" bind:value={depTime} />
                </div>
                <div class="field">
                    <label class="field-label" for="arr-time">Arrival time</label>
                    <input id="arr-time" type="time" bind:value={arrTime} />
                </div>
            </div>
            <p class="hint">Enter local times at each airport, as shown on your ticket.</p>
            <button class="btn primary" type="submit">Predict In-Flight Sun Views</button>
        </form>
    {:else}
        <form class="fields" onsubmit={findFlights}>
            {#if mode === 'number'}
                <div class="row">
                    <div class="field grow">
                        <label class="field-label" for="flight-code">Flight number</label>
                        <input id="flight-code" type="text" placeholder="e.g. UA2410" bind:value={flightCode} maxlength="8" autocomplete="off" />
                    </div>
                    {@render dateField()}
                </div>
            {:else}
                {@render airportField('dep')}
                {@render airportField('arr')}
                {@render dateField()}
            {/if}
            <button class="btn primary" type="submit" disabled={isSearching}>
                {isSearching ? 'Searching…' : mode === 'number' ? 'Find flight' : 'Find flights'}
            </button>
        </form>

        {#if schedules.length > 0}
            <div class="schedules">
                <p class="hint">{schedules.length === 1 ? '1 flight' : `${schedules.length} flights`} on this day. Pick yours:</p>
                <ul>
                    {#each schedules as f (f.flightIata + f.depTime)}
                        <li>
                            <button type="button" class="schedule" onclick={() => predict(f.depIata, f.arrIata, f.depTime, f.arrTime)}>
                                <span class="schedule-main">
                                    <strong>{f.flightIata}</strong>
                                    <span>{f.depIata} {f.depTime} → {f.arrIata} {f.arrTime}</span>
                                </span>
                                <small>
                                    {duration(f.durationMin)}{#if f.codeshares.length}{duration(f.durationMin) ? ' · ' : ''}also {f.codeshares.slice(0, 3).join(', ')}{/if}
                                </small>
                            </button>
                        </li>
                    {/each}
                </ul>
                <p class="hint">Times are local at each airport, from the airline timetable.</p>
            </div>
        {/if}
    {/if}

    <!-- Stays mounted so new messages are announced. -->
    <p class="message" role="status">{searchMessage}</p>
    <p class="error-text message" role="alert">{errorMessage}</p>

    <button class="btn link" type="button" onclick={onSwitchMode}>← Back to location mode</button>
</div>

<style>
    .flight-input { width: 100%; max-width: 640px; display: flex; flex-direction: column; gap: 1rem; }
    .fields { display: flex; flex-direction: column; gap: 1rem; }
    .field { position: relative; }
    .row { display: flex; gap: 0.75rem; align-items: flex-end; }
    .grow { flex: 1; }
    .field-label { display: block; font-size: 0.85rem; margin-bottom: 0.35rem; }
    .hint { margin: 0; font-size: 0.8rem; }
    .message { margin: 0; }
    .time-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem; }
    .btn { border-color: var(--text-accent); }
    .btn.primary { font-weight: 600; }
    .btn.link { background: transparent; border: none; font-size: 0.9rem; align-self: center; }
    .btn.link:hover { transform: none; text-decoration: underline; }
    .iata { color: var(--text-accent); margin-right: 0.35rem; }

    .segmented {
        display: flex;
        align-self: center;
        gap: 0.25rem;
        padding: 0.25rem;
        border-radius: 999px;
        background: var(--surface);
        border: 1px solid var(--border);
    }
    .segmented button {
        padding: 0.35rem 1rem;
        font-size: 0.85rem;
        background: transparent;
        border: none;
        border-radius: 999px;
        backdrop-filter: none;
    }
    .segmented button:hover { transform: none; }
    .segmented button:not(.active):hover { background: var(--surface); }
    .segmented button.active { background: var(--text-primary); color: var(--background-start); font-weight: 600; }

    .schedules { display: flex; flex-direction: column; gap: 0.5rem; }
    .schedules ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.4rem; }
    .schedule {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        text-align: left;
        padding: 0.65rem 0.9rem;
    }
    .schedule-main { display: flex; gap: 0.75rem; align-items: baseline; flex-wrap: wrap; }
    .schedule-main strong { color: var(--text-accent); }

    @media (max-width: 520px) {
        .time-row { grid-template-columns: 1fr; }
        .row { flex-direction: column; align-items: stretch; }
    }
</style>

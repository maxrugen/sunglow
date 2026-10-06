<script lang="ts">
    import type { Airport } from '$lib/types';
    import Combobox from './Combobox.svelte';

    type FlightSubmitDetail = { depIata: string; arrIata: string; depTime: string; arrTime: string };

    interface Props {
        /** Whether the server has an AviationStack key (decided in the page load). */
        lookupAvailable?: boolean;
        onFlightSubmit: (flight: FlightSubmitDetail) => void;
        onSwitchMode: () => void;
    }

    let { lookupAvailable = false, onFlightSubmit, onSwitchMode }: Props = $props();

    /** Today's date in the browser's zone as YYYY-MM-DD (toISOString would give the UTC date). */
    function localDateString(d = new Date()): string {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // Flight number lookup state
    let flightCode: string = $state('');
    let flightDate: string = $state(localDateString());
    let isLookingUp: boolean = $state(false);

    // Manual entry state
    let depSearch: string = $state('');
    let arrSearch: string = $state('');
    let depResults: Airport[] = $state([]);
    let arrResults: Airport[] = $state([]);
    let selectedDep: Airport | null = null;
    let selectedArr: Airport | null = null;
    let dateStr: string = $state(localDateString());
    let depTime: string = $state('');
    let arrTime: string = $state('');
    let errorMessage: string = $state('');

    const airportLabel = (a: Airport) => `${a.iata} – ${a.name}`;
    const resultsStatus = (n: number) => (n ? `${n} airport${n === 1 ? '' : 's'} found` : '');

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

    async function lookupFlight() {
        errorMessage = '';
        const code = flightCode.trim().toUpperCase();
        if (!code) { errorMessage = 'Enter a flight code (e.g. AA1004)'; return; }

        isLookingUp = true;
        try {
            const res = await fetch(`/api/flight-lookup?flight=${encodeURIComponent(code)}&date=${encodeURIComponent(flightDate)}`);
            const data = await res.json();
            if (!res.ok) { errorMessage = data.error || 'Flight lookup failed.'; return; }

            // Populate fields from lookup
            if (data.departure?.match) selectDep(data.departure.match);
            if (data.arrival?.match) selectArr(data.arrival.match);

            // AviationStack's scheduled times are airport-local despite the "+00:00"
            // suffix, so take the wall-clock part as-is instead of parsing it.
            if (data.departure?.scheduled) {
                depTime = data.departure.scheduled.slice(11, 16);
                dateStr = data.departure.scheduled.slice(0, 10);
            }
            if (data.arrival?.scheduled) {
                arrTime = data.arrival.scheduled.slice(11, 16);
            }
        } catch {
            errorMessage = 'Flight lookup failed. Please enter details manually.';
        } finally {
            isLookingUp = false;
        }
    }

    function submit(e: SubmitEvent) {
        e.preventDefault();
        errorMessage = '';
        if (!selectedDep) { errorMessage = 'Select a departure airport.'; return; }
        if (!selectedArr) { errorMessage = 'Select an arrival airport.'; return; }
        if (!depTime) { errorMessage = 'Enter departure time.'; return; }
        if (!arrTime) { errorMessage = 'Enter arrival time.'; return; }

        // Wall-clock times without an offset: the server reads each one in its
        // airport's time zone and picks the arrival date (overnight, date line).
        onFlightSubmit({
            depIata: selectedDep.iata,
            arrIata: selectedArr.iata,
            depTime: `${dateStr}T${depTime}:00`,
            arrTime: `${dateStr}T${arrTime}:00`,
        });
    }

    function onLookupSubmit(e: SubmitEvent) {
        e.preventDefault();
        lookupFlight();
    }
</script>

<div class="flight-input">
    {#if lookupAvailable}
        <form class="lookup-section" onsubmit={onLookupSubmit}>
            <label class="field-label" for="flight-code-input">Flight number (optional)</label>
            <div class="lookup-row">
                <input id="flight-code-input" type="text" placeholder="e.g. AA1004" bind:value={flightCode} maxlength="10" />
                <label class="visually-hidden" for="flight-lookup-date">Flight date</label>
                <input id="flight-lookup-date" type="date" bind:value={flightDate} />
                <button class="btn" type="submit" disabled={isLookingUp}>
                    {isLookingUp ? 'Looking up…' : 'Look up'}
                </button>
            </div>
        </form>
        <div class="divider"><span>or enter manually</span></div>
    {/if}

    <form class="fields" onsubmit={submit}>
        <Combobox
            id="dep-input"
            label="Departure airport"
            placeholder="Search city or IATA code"
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

        <Combobox
            id="arr-input"
            label="Arrival airport"
            placeholder="Search city or IATA code"
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

        <div class="time-row">
            <div class="field">
                <label class="field-label" for="date-input">Departure date</label>
                <input id="date-input" type="date" bind:value={dateStr} />
            </div>
            <div class="field">
                <label class="field-label" for="dep-time">Departure time</label>
                <input id="dep-time" type="time" bind:value={depTime} />
            </div>
            <div class="field">
                <label class="field-label" for="arr-time">Arrival time</label>
                <input id="arr-time" type="time" bind:value={arrTime} />
            </div>
        </div>
        <p class="time-hint">Enter local times at each airport, as shown on your ticket.</p>

        <p class="error-text form-error" role="alert">{errorMessage}</p>

        <div class="actions">
            <button class="btn primary" type="submit">Predict In-Flight Sun Views</button>
            <button class="btn link" type="button" onclick={onSwitchMode}>← Back to location mode</button>
        </div>
    </form>
</div>

<style>
    .flight-input { width: 100%; max-width: 640px; display: flex; flex-direction: column; gap: 1rem; }
    .fields { display: flex; flex-direction: column; gap: 1rem; }
    .field { position: relative; }
    .field-label { display: block; font-size: 0.85rem; margin-bottom: 0.35rem; opacity: 0.9; }
    .time-hint { margin: 0; font-size: 0.8rem; opacity: 0.85; }
    .time-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem; }
    .lookup-section { display: flex; flex-direction: column; gap: 0.35rem; }
    .lookup-row { display: flex; gap: 0.5rem; }
    .lookup-row input[type="text"] { flex: 1; }
    .lookup-row input[type="date"] { width: auto; }
    .divider { text-align: center; opacity: 0.85; font-size: 0.85rem; margin: 0.25rem 0; }
    .actions { display: flex; flex-direction: column; gap: 0.5rem; align-items: stretch; }
    .btn { border-color: var(--text-accent); }
    .btn.primary { font-weight: 600; }
    .btn.link { background: transparent; border: none; font-size: 0.9rem; }
    .btn.link:hover { transform: none; text-decoration: underline; }
    /* Stays mounted (and in the accessibility tree) so new errors are announced. */
    .form-error { margin: 0; }
    .iata { color: var(--text-accent); margin-right: 0.35rem; }

    @media (max-width: 520px) {
        .time-row { grid-template-columns: 1fr; }
        .lookup-row { flex-direction: column; }
    }
</style>

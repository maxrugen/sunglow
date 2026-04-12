<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import airportsData from '$lib/data/airports.json';

    type Airport = { iata: string; name: string; city: string; country: string; lat: number; lon: number };
    type FlightSubmitDetail = { depIata: string; arrIata: string; depTime: string; arrTime: string };

    const dispatch = createEventDispatcher<{ flightSubmit: FlightSubmitDetail; flightError: { message: string }; switchMode: void }>();

    const airports: Airport[] = airportsData as Airport[];

    // Flight number lookup state
    let flightCode: string = '';
    let flightDate: string = new Date().toISOString().slice(0, 10);
    let isLookingUp: boolean = false;
    let lookupAvailable: boolean = false;

    // Check if flight lookup is available
    fetch('/api/flight-lookup?flight=TEST', { method: 'HEAD' }).then(r => {
        lookupAvailable = r.status !== 501;
    }).catch(() => {});

    // Manual entry state
    let depSearch: string = '';
    let arrSearch: string = '';
    let depResults: Airport[] = [];
    let arrResults: Airport[] = [];
    let selectedDep: Airport | null = null;
    let selectedArr: Airport | null = null;
    let depActiveIndex: number = -1;
    let arrActiveIndex: number = -1;
    let depTime: string = '';
    let arrTime: string = '';
    let errorMessage: string = '';
    let isSubmitting: boolean = false;
    let depInputEl: HTMLInputElement;
    let arrInputEl: HTMLInputElement;
    let depRootEl: HTMLDivElement;
    let arrRootEl: HTMLDivElement;

    // Default date: today
    let dateStr: string = new Date().toISOString().slice(0, 10);

    function searchAirport(query: string): Airport[] {
        const q = query.trim().toUpperCase();
        if (q.length < 2) return [];
        // IATA exact match first
        const exactIata = airports.filter(a => a.iata === q);
        if (exactIata.length > 0) return exactIata.slice(0, 8);
        // Filter by IATA prefix, then city/name substring
        const byIata = airports.filter(a => a.iata.startsWith(q));
        const byName = airports.filter(a =>
            !a.iata.startsWith(q) && (
                a.name.toUpperCase().includes(q) ||
                a.city.toUpperCase().includes(q)
            )
        );
        return [...byIata, ...byName].slice(0, 8);
    }

    function onDepInput() {
        depResults = searchAirport(depSearch);
        depActiveIndex = depResults.length > 0 ? 0 : -1;
        if (selectedDep && depSearch !== `${selectedDep.iata} – ${selectedDep.name}`) {
            selectedDep = null;
        }
    }

    function onArrInput() {
        arrResults = searchAirport(arrSearch);
        arrActiveIndex = arrResults.length > 0 ? 0 : -1;
        if (selectedArr && arrSearch !== `${selectedArr.iata} – ${selectedArr.name}`) {
            selectedArr = null;
        }
    }

    function selectDep(a: Airport) {
        selectedDep = a;
        depSearch = `${a.iata} – ${a.name}`;
        depResults = [];
        depActiveIndex = -1;
    }

    function selectArr(a: Airport) {
        selectedArr = a;
        arrSearch = `${a.iata} – ${a.name}`;
        arrResults = [];
        arrActiveIndex = -1;
    }

    function onDepKeyDown(e: KeyboardEvent) {
        if (depResults.length === 0) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); depActiveIndex = (depActiveIndex + 1) % depResults.length; }
        else if (e.key === 'ArrowUp') { e.preventDefault(); depActiveIndex = (depActiveIndex - 1 + depResults.length) % depResults.length; }
        else if (e.key === 'Enter' && depActiveIndex >= 0) { e.preventDefault(); selectDep(depResults[depActiveIndex]); }
        else if (e.key === 'Escape') { depResults = []; depActiveIndex = -1; }
    }

    function onArrKeyDown(e: KeyboardEvent) {
        if (arrResults.length === 0) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); arrActiveIndex = (arrActiveIndex + 1) % arrResults.length; }
        else if (e.key === 'ArrowUp') { e.preventDefault(); arrActiveIndex = (arrActiveIndex - 1 + arrResults.length) % arrResults.length; }
        else if (e.key === 'Enter' && arrActiveIndex >= 0) { e.preventDefault(); selectArr(arrResults[arrActiveIndex]); }
        else if (e.key === 'Escape') { arrResults = []; arrActiveIndex = -1; }
    }

    function onWindowClick(e: MouseEvent) {
        const t = e.target as Node | null;
        if (t && depRootEl && !depRootEl.contains(t)) { depResults = []; depActiveIndex = -1; }
        if (t && arrRootEl && !arrRootEl.contains(t)) { arrResults = []; arrActiveIndex = -1; }
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
            const depAp = airports.find(a => a.iata === data.departure?.iata?.toUpperCase());
            const arrAp = airports.find(a => a.iata === data.arrival?.iata?.toUpperCase());

            if (depAp) selectDep(depAp);
            if (arrAp) selectArr(arrAp);

            if (data.departure?.scheduled) {
                const d = new Date(data.departure.scheduled);
                depTime = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                dateStr = data.departure.scheduled.slice(0, 10);
            }
            if (data.arrival?.scheduled) {
                const d = new Date(data.arrival.scheduled);
                arrTime = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
            }
        } catch {
            errorMessage = 'Flight lookup failed. Please enter details manually.';
        } finally {
            isLookingUp = false;
        }
    }

    function submit() {
        errorMessage = '';
        if (!selectedDep) { errorMessage = 'Select a departure airport.'; return; }
        if (!selectedArr) { errorMessage = 'Select an arrival airport.'; return; }
        if (!depTime) { errorMessage = 'Enter departure time.'; return; }
        if (!arrTime) { errorMessage = 'Enter arrival time.'; return; }

        const depISO = `${dateStr}T${depTime}:00`;
        let arrISO = `${dateStr}T${arrTime}:00`;

        // If arrival time is before departure, assume next day
        if (arrTime <= depTime) {
            const nextDay = new Date(new Date(dateStr).getTime() + 86400000);
            const nd = nextDay.toISOString().slice(0, 10);
            arrISO = `${nd}T${arrTime}:00`;
        }

        dispatch('flightSubmit', {
            depIata: selectedDep.iata,
            arrIata: selectedArr.iata,
            depTime: depISO,
            arrTime: arrISO,
        });
    }
</script>

<svelte:window on:click={onWindowClick} />
<div class="flight-input">
    {#if lookupAvailable}
        <div class="lookup-section">
            <label class="field-label" for="flight-code-input">Flight number (optional)</label>
            <div class="lookup-row">
                <input id="flight-code-input" type="text" placeholder="e.g. AA1004" bind:value={flightCode} maxlength="10" />
                <input type="date" bind:value={flightDate} />
                <button class="btn" on:click={lookupFlight} disabled={isLookingUp}>
                    {isLookingUp ? 'Looking up…' : 'Look up'}
                </button>
            </div>
        </div>
        <div class="divider"><span>or enter manually</span></div>
    {/if}

    <div class="fields">
        <div class="field" bind:this={depRootEl}>
            <label class="field-label" for="dep-input">Departure airport</label>
            <input
                id="dep-input"
                type="text"
                placeholder="Search city or IATA code"
                bind:value={depSearch}
                on:input={onDepInput}
                on:keydown={onDepKeyDown}
                bind:this={depInputEl}
                autocomplete="off"
            />
            {#if depResults.length > 0}
                <ul class="results" role="listbox">
                    {#each depResults as r, i}
                        <li>
                            <button type="button" class="result" class:active={i === depActiveIndex} role="option" aria-selected={i === depActiveIndex ? 'true' : 'false'} on:click={() => selectDep(r)}>
                                <span><strong>{r.iata}</strong> {r.name}</span>
                                <small>{r.city}, {r.country}</small>
                            </button>
                        </li>
                    {/each}
                </ul>
            {/if}
        </div>

        <div class="field" bind:this={arrRootEl}>
            <label class="field-label" for="arr-input">Arrival airport</label>
            <input
                id="arr-input"
                type="text"
                placeholder="Search city or IATA code"
                bind:value={arrSearch}
                on:input={onArrInput}
                on:keydown={onArrKeyDown}
                bind:this={arrInputEl}
                autocomplete="off"
            />
            {#if arrResults.length > 0}
                <ul class="results" role="listbox">
                    {#each arrResults as r, i}
                        <li>
                            <button type="button" class="result" class:active={i === arrActiveIndex} role="option" aria-selected={i === arrActiveIndex ? 'true' : 'false'} on:click={() => selectArr(r)}>
                                <span><strong>{r.iata}</strong> {r.name}</span>
                                <small>{r.city}, {r.country}</small>
                            </button>
                        </li>
                    {/each}
                </ul>
            {/if}
        </div>

        <div class="time-row">
            <div class="field">
                <label class="field-label" for="date-input">Date</label>
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
    </div>

    {#if errorMessage}
        <p class="error" aria-live="polite">{errorMessage}</p>
    {/if}

    <div class="actions">
        <button class="btn primary" on:click={submit} disabled={isSubmitting}>
            {isSubmitting ? 'Predicting…' : 'Predict In-Flight Sunset'}
        </button>
        <button class="btn link" on:click={() => dispatch('switchMode')}>
            ← Back to location mode
        </button>
    </div>
</div>

<style>
    .flight-input { width: 100%; max-width: 640px; display: flex; flex-direction: column; gap: 1rem; }
    .fields { display: flex; flex-direction: column; gap: 1rem; }
    .field { position: relative; }
    .field-label { display: block; font-size: 0.85rem; margin-bottom: 0.35rem; opacity: 0.9; }
    .time-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem; }
    .lookup-section { display: flex; flex-direction: column; gap: 0.35rem; }
    .lookup-row { display: flex; gap: 0.5rem; }
    .lookup-row input[type="text"] { flex: 1; }
    .lookup-row input[type="date"] { width: auto; }
    .divider { text-align: center; opacity: 0.6; font-size: 0.85rem; margin: 0.25rem 0; }
    .divider span { background: transparent; padding: 0 0.5rem; }
    .actions { display: flex; flex-direction: column; gap: 0.5rem; align-items: stretch; }
    .btn {
        padding: 0.75rem 1rem;
        border-radius: 10px;
        border: 1px solid var(--text-accent);
        background: rgba(255,255,255,0.08);
        color: var(--text-primary);
        cursor: pointer;
        transition: transform 0.15s ease, background 0.2s ease;
        backdrop-filter: blur(8px);
    }
    .btn:hover { transform: translateY(-1px); background: rgba(255,255,255,0.14); }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
    .btn.primary { font-weight: 600; }
    .btn.link { background: transparent; border: none; font-size: 0.9rem; opacity: 0.8; }
    .btn.link:hover { opacity: 1; transform: none; background: transparent; }
    .error { color: #ffd3d3; margin: 0; }
    .results { position: absolute; z-index: 10; top: 100%; left: 0; right: 0; margin: 0.35rem 0 0; padding: 0; list-style: none; display: grid; gap: 0.35rem; max-height: 220px; overflow-y: auto; }
    .result { width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.75rem; border-radius: 10px; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.14); cursor: pointer; color: var(--text-primary); backdrop-filter: blur(12px); }
    .result:hover { background: rgba(255,255,255,0.14); }
    .result.active { border-color: var(--text-accent); background: rgba(255,255,255,0.14); }
    .result strong { color: var(--text-accent); margin-right: 0.5rem; }

    @media (max-width: 520px) {
        .time-row { grid-template-columns: 1fr; }
        .lookup-row { flex-direction: column; }
    }
</style>

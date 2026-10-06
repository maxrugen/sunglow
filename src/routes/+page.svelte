<script lang="ts">
    import LocationInput from '$lib/components/LocationInput.svelte';
    import ResultsDisplay from '$lib/components/ResultsDisplay.svelte';
    import PushSubscribeButton from '$lib/components/PushSubscribeButton.svelte';
    import FlightInput from '$lib/components/FlightInput.svelte';
    import FlightResultsDisplay from '$lib/components/FlightResultsDisplay.svelte';
    import RatingPrompt from '$lib/components/RatingPrompt.svelte';
    import { rememberForRating } from '$lib/rating-store';
    import { onMount, tick, untrack } from 'svelte';
    import { applyScoreTheme, resetScoreTheme, scoreLabel } from '$lib/score';
    import { errorMessageFrom } from '$lib/http';
    import { reverseGeocode } from '$lib/reverse-geocode';
    import { toClientPrediction, type ClientPrediction, type FlightPredictionResponse, type SkyEvent } from '$lib/types';
    import { EVENT_COPY, SKY_EVENTS, isSkyEvent } from '$lib/events';
    import type { PageData } from './$types';

    let { data }: { data: PageData } = $props();

    type FlightRequest = { depIata: string; arrIata: string; depTime: string; arrTime: string };

    let mode: 'location' | 'flight' = $state('location');

    // Location mode state. Deep links (?lat=&lon=&label=, e.g. from push
    // notifications) arrive server-rendered and only seed the initial state;
    // nothing in the app navigates to them client-side.
    const ssr = untrack(() => data.ssr);
    let predictionData: ClientPrediction | null = $state(ssr ? toClientPrediction(ssr) : null);
    let isLoading: boolean = $state(false);
    let location: { latitude: number; longitude: number } | null = $state(
        ssr ? { latitude: ssr.latitude, longitude: ssr.longitude } : null
    );
    let locationLabel: string = $state(ssr?.label ?? '');
    // Sunset or sunrise: from the deep link if given, else the last choice (restored on mount).
    const linkedEvent = untrack(() => data.event);
    let selectedEvent: SkyEvent = $state(linkedEvent ?? 'sunset');

    // Flight mode state
    let flightPrediction: FlightPredictionResponse | null = $state(null);
    let isFlightLoading: boolean = $state(false);

    // Shared feedback: an always-mounted status line for screen readers, and
    // an error panel that can repeat the failed action.
    let statusMessage: string = $state('');
    let errorMessage: string = $state('');
    let retryAction: (() => void) | null = $state(null);
    // Only the latest request may update the screen (e.g. after a quick Sunset/Sunrise switch).
    let requestSeq = 0;

    function friendlyError(err: unknown, fallback: string): string {
        if (err instanceof TypeError) return "Can't reach Sunglow right now. Check your connection and try again.";
        return err instanceof Error && err.message ? err.message : fallback;
    }

    function showError(message: string, retry: () => void) {
        errorMessage = message;
        retryAction = retry;
        statusMessage = '';
    }

    function clearError() {
        errorMessage = '';
        retryAction = null;
    }

    async function focusById(id: string) {
        await tick();
        document.getElementById(id)?.focus();
    }

    function rememberLocation(latitude: number, longitude: number) {
        try { localStorage.setItem('sunglow:last', JSON.stringify({ latitude, longitude, label: locationLabel })); } catch { /* storage unavailable */ }
    }

    async function fetchPrediction(latitude: number, longitude: number) {
        const seq = ++requestSeq;
        isLoading = true;
        clearError();
        predictionData = null;
        statusMessage = `Loading ${EVENT_COPY[selectedEvent].noun} prediction…`;

        try {
            const res = await fetch('/api/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ latitude, longitude, event: selectedEvent })
            });
            if (!res.ok) throw new Error(await errorMessageFrom(res, 'The prediction failed. Try again in a moment.'));
            const prediction = toClientPrediction(await res.json());
            if (seq !== requestSeq) return;

            predictionData = prediction;
            applyScoreTheme(prediction.qualityScore);
            rememberLocation(latitude, longitude);
            rememberForRating(prediction, locationLabel);
            statusMessage = `${EVENT_COPY[prediction.event].title} quality ${prediction.qualityScore}%, ${scoreLabel(prediction.qualityScore)}.`;
            focusById('result-heading');
        } catch (err) {
            if (seq !== requestSeq) return;
            showError(friendlyError(err, 'The prediction failed.'), () => fetchPrediction(latitude, longitude));
        } finally {
            if (seq === requestSeq) isLoading = false;
        }
    }

    async function onLocationSuccess({ latitude, longitude, label }: { latitude: number; longitude: number; label?: string }) {
        location = { latitude, longitude };
        if (label) {
            locationLabel = label;
        } else {
            // Coordinates until (or unless) a friendly name comes back.
            locationLabel = `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
            locationLabel = (await reverseGeocode(latitude, longitude)) ?? locationLabel;
        }
        fetchPrediction(latitude, longitude);
    }

    function newSearch() {
        requestSeq++;
        predictionData = null;
        isLoading = false;
        clearError();
        statusMessage = '';
        resetScoreTheme();
        focusById('city-input');
    }

    // Note: we no longer auto-load the last location on mount so that a reload returns to the search view.
    function selectEvent(event: SkyEvent) {
        if (event === selectedEvent) return;
        selectedEvent = event;
        try { localStorage.setItem('sunglow:event', event); } catch { /* storage unavailable */ }
        // Re-run the prediction for the location on screen (also if one is still loading).
        if (location && (predictionData || isLoading || errorMessage)) fetchPrediction(location.latitude, location.longitude);
    }

    onMount(() => {
        if (!linkedEvent) {
            try {
                const stored = localStorage.getItem('sunglow:event');
                if (isSkyEvent(stored)) selectedEvent = stored;
            } catch { /* storage unavailable */ }
        }
        if (!ssr) return;
        applyScoreTheme(ssr.qualityScore);
        rememberLocation(ssr.latitude, ssr.longitude);
        if (predictionData) rememberForRating(predictionData, locationLabel);
    });

    function switchMode(target: 'location' | 'flight') {
        if (target === mode) return;
        mode = target;
        requestSeq++;
        isLoading = false;
        isFlightLoading = false;
        clearError();
        statusMessage = '';
        predictionData = null;
        flightPrediction = null;
        resetScoreTheme();
    }

    async function onFlightSubmit(flight: FlightRequest) {
        const seq = ++requestSeq;
        isFlightLoading = true;
        clearError();
        flightPrediction = null;
        statusMessage = 'Analyzing flight route…';

        try {
            const res = await fetch('/api/predict-flight', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(flight)
            });
            if (!res.ok) throw new Error(await errorMessageFrom(res, 'The flight prediction failed. Try again in a moment.'));
            const result: FlightPredictionResponse = await res.json();
            if (seq !== requestSeq) return;

            flightPrediction = result;
            const scores = result.sightings.map((s) => s.qualityScore).filter((v): v is number => v != null);
            if (scores.length) applyScoreTheme(Math.max(...scores));
            const n = result.sightings.length;
            statusMessage = n ? `${n} ${n === 1 ? 'sunrise or sunset' : 'sunrises or sunsets'} during this flight.` : 'No sunrise or sunset during this flight.';
            focusById('flight-result-heading');
        } catch (err) {
            if (seq !== requestSeq) return;
            showError(friendlyError(err, 'The flight prediction failed.'), () => onFlightSubmit(flight));
        } finally {
            if (seq === requestSeq) isFlightLoading = false;
        }
    }

    function flightBack() {
        flightPrediction = null;
        statusMessage = '';
        resetScoreTheme();
        // Whichever field the active search tab shows.
        tick().then(() => (document.getElementById('flight-code') ?? document.getElementById('dep-input'))?.focus());
    }
</script>

<svelte:head>
    <title>Sunglow — Sunset &amp; Sunrise Quality Prediction</title>
    <meta name="description" content="Predict sunset and sunrise quality with real-time weather and solar timings." />
    <!-- Reverse geocoding for "Use My Location" runs in the browser. -->
    <link rel="preconnect" href="https://api.bigdatacloud.net" crossorigin="anonymous">
    <meta name="theme-color" content="#3e4a61" />
</svelte:head>

<main class="shell">
    <header class="header">
        <h1>Sunglow</h1>
        <p class="tagline">{mode === 'location' ? EVENT_COPY[selectedEvent].tagline : 'Will you see a sunrise or sunset on your flight?'}</p>
    </header>

    <nav class="mode-toggle" aria-label="Prediction mode">
        <button class="toggle-btn" class:active={mode === 'location'} aria-pressed={mode === 'location'} onclick={() => switchMode('location')}>Location</button>
        <button class="toggle-btn" class:active={mode === 'flight'} aria-pressed={mode === 'flight'} onclick={() => switchMode('flight')}>Flight</button>
    </nav>

    {#if mode === 'location'}
        <div class="mode-toggle event-toggle" role="group" aria-label="Sunset or sunrise">
            {#each SKY_EVENTS as event (event)}
                <button
                    class="toggle-btn"
                    class:active={selectedEvent === event}
                    aria-pressed={selectedEvent === event}
                    onclick={() => selectEvent(event)}
                >
                    <span aria-hidden="true">{EVENT_COPY[event].icon}&nbsp;</span>{EVENT_COPY[event].title}
                </button>
            {/each}
        </div>
        <RatingPrompt />
        <!-- The search stays mounted (just hidden) so "New search" returns to what was typed. -->
        <div class="panel" hidden={isLoading || !!predictionData}>
            <LocationInput {onLocationSuccess} />
        </div>
        {#if isLoading}
            <div class="loader" aria-hidden="true">Loading prediction…</div>
        {:else if predictionData}
            <ResultsDisplay prediction={predictionData} {locationLabel} />
            {#if location}
                <PushSubscribeButton location={{ latitude: location.latitude, longitude: location.longitude, label: locationLabel }} event={selectedEvent} />
            {/if}
            <button class="secondary-btn" type="button" onclick={newSearch}>← New search</button>
        {/if}
    {:else}
        <!-- Kept mounted while results show, so Back and errors keep the entered flight. -->
        <div class="panel" hidden={isFlightLoading || !!flightPrediction}>
            <FlightInput lookupAvailable={data.flightLookupAvailable} {onFlightSubmit} onSwitchMode={() => switchMode('location')} />
        </div>
        {#if isFlightLoading}
            <div class="loader" aria-hidden="true">Analyzing flight route…</div>
        {:else if flightPrediction}
            <FlightResultsDisplay prediction={flightPrediction} onBack={flightBack} />
        {/if}
    {/if}

    <!-- Always mounted so changes are announced. -->
    <p class="visually-hidden" role="status">{statusMessage}</p>
    <div class="alert-region" role="alert">
        {#if errorMessage}
            <div class="error-panel">
                <p class="error-text">{errorMessage}</p>
                {#if retryAction}
                    <button type="button" onclick={() => retryAction?.()}>Try again</button>
                {/if}
            </div>
        {/if}
    </div>
</main>

<style>
    .shell {
        min-height: 100svh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 2rem 1rem;
        gap: 1.5rem;
        color: var(--text-primary);
    }
    .header { text-align: center; }
    h1 { margin: 0; font-size: 2rem; }
    .tagline { margin: 0.25rem 0 0; }
    /* Segmented control: the selected option is a filled pill in the text color. */
    .mode-toggle {
        display: flex;
        gap: 0.25rem;
        padding: 0.25rem;
        border-radius: 999px;
        background: var(--surface);
        border: 1px solid var(--border);
    }
    .toggle-btn {
        padding: 0.45rem 1.25rem;
        background: transparent;
        border: none;
        border-radius: 999px;
        color: var(--text-primary);
        cursor: pointer;
        font-size: 0.95rem;
        backdrop-filter: none;
        transition: background 0.2s, color 0.2s;
    }
    .toggle-btn.active {
        background: var(--text-primary);
        color: var(--background-start);
        font-weight: 600;
    }
    .toggle-btn:hover { transform: none; }
    .toggle-btn:not(.active):hover { background: var(--surface); }
    .event-toggle { margin-top: -0.75rem; }
    .event-toggle .toggle-btn { font-size: 0.85rem; padding: 0.3rem 1rem; }
    .panel { width: 100%; max-width: 640px; display: flex; justify-content: center; }
    .panel[hidden] { display: none; }
    .loader { opacity: 0.9; }
    .secondary-btn { background: transparent; }
    .alert-region { width: 100%; max-width: 640px; }
    .error-panel {
        width: 100%;
        max-width: 640px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.75rem 1rem;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 12px;
    }
    .error-panel p { margin: 0; }
</style>

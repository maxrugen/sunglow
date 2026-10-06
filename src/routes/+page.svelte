<script lang="ts">
    import LocationInput from '$lib/components/LocationInput.svelte';
    import ResultsDisplay from '$lib/components/ResultsDisplay.svelte';
    import PushSubscribeButton from '$lib/components/PushSubscribeButton.svelte';
    import FlightInput from '$lib/components/FlightInput.svelte';
    import FlightResultsDisplay from '$lib/components/FlightResultsDisplay.svelte';
    import RatingPrompt from '$lib/components/RatingPrompt.svelte';
    import { rememberForRating } from '$lib/rating-store';
    import { onMount, untrack } from 'svelte';
    import { applyScoreTheme } from '$lib/score';
    import { errorMessageFrom } from '$lib/http';
    import { toClientPrediction, type ClientPrediction, type FlightPredictionResponse, type SkyEvent } from '$lib/types';
    import { EVENT_COPY, SKY_EVENTS, isSkyEvent } from '$lib/events';
    import type { PageData } from './$types';

    let { data }: { data: PageData } = $props();

    let mode: 'location' | 'flight' = $state('location');

    // Location mode state. Deep links (?lat=&lon=&label=, e.g. from push
    // notifications) arrive server-rendered and only seed the initial state;
    // nothing in the app navigates to them client-side.
    const ssr = untrack(() => data.ssr);
    let predictionData: ClientPrediction | null = $state(ssr ? toClientPrediction(ssr) : null);
    let isLoading: boolean = $state(false);
    let errorMessage: string = $state('');
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

    function rememberLocation(latitude: number, longitude: number) {
        try { localStorage.setItem('sunglow:last', JSON.stringify({ latitude, longitude, label: locationLabel })); } catch {}
    }

    async function fetchPrediction(latitude: number, longitude: number) {
        isLoading = true;
        errorMessage = '';
        predictionData = null;

        try {
            const res = await fetch('/api/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ latitude, longitude, event: selectedEvent })
            });
            if (!res.ok) throw new Error(await errorMessageFrom(res, 'Prediction request failed'));

            predictionData = toClientPrediction(await res.json());
            applyScoreTheme(predictionData.qualityScore);
            rememberLocation(latitude, longitude);
            rememberForRating(predictionData, locationLabel);
        } catch (err) {
            errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
        } finally {
            isLoading = false;
        }
    }

    async function onLocationSuccess({ latitude, longitude, label }: { latitude: number; longitude: number; label?: string }) {
        location = { latitude, longitude };
        if (label) {
            locationLabel = label;
        } else {
            locationLabel = `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`; // temporary placeholder
            // reverse geocode for a friendly name
            try {
                const res = await fetch(`/api/reverse-geocode?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}`);
                if (res.ok) {
                    const body = await res.json();
                    locationLabel = body?.label || '';
                }
            } catch {
                /* ignore */
            }
        }
        fetchPrediction(latitude, longitude);
    }

    function onLocationError({ message }: { message: string }) {
        errorMessage = message || 'Failed to get location.';
    }

    // Note: we no longer auto-load the last location on mount so that a reload returns to the search view.
    function selectEvent(event: SkyEvent) {
        if (event === selectedEvent) return;
        selectedEvent = event;
        try { localStorage.setItem('sunglow:event', event); } catch {}
        // Re-run the prediction for the location already on screen.
        if (location && (predictionData || errorMessage)) fetchPrediction(location.latitude, location.longitude);
    }

    onMount(() => {
        if (!linkedEvent) {
            try {
                const stored = localStorage.getItem('sunglow:event');
                if (isSkyEvent(stored)) selectedEvent = stored;
            } catch {}
        }
        if (!ssr) return;
        applyScoreTheme(ssr.qualityScore);
        rememberLocation(ssr.latitude, ssr.longitude);
        if (predictionData) rememberForRating(predictionData, locationLabel);
    });

    function switchMode(target: 'location' | 'flight') {
        mode = target;
        errorMessage = '';
        predictionData = null;
        flightPrediction = null;
    }

    async function onFlightSubmit(flight: { depIata: string; arrIata: string; depTime: string; arrTime: string }) {
        isFlightLoading = true;
        errorMessage = '';
        flightPrediction = null;

        try {
            const res = await fetch('/api/predict-flight', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(flight)
            });
            if (!res.ok) throw new Error(await errorMessageFrom(res, 'Flight prediction request failed'));

            flightPrediction = await res.json();
            if (flightPrediction?.qualityScore != null) {
                applyScoreTheme(flightPrediction.qualityScore);
            }
        } catch (err) {
            errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
        } finally {
            isFlightLoading = false;
        }
    }
</script>

<svelte:head>
    <title>Sunglow — Sunset &amp; Sunrise Quality Prediction</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Predict sunset and sunrise quality with real-time weather and solar timings." />
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">
    <link rel="preconnect" href="https://api.open-meteo.com" crossorigin="anonymous">
    <link rel="preconnect" href="https://geocoding-api.open-meteo.com" crossorigin="anonymous">
    <link rel="preconnect" href="https://api.bigdatacloud.net" crossorigin="anonymous">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
    <meta name="theme-color" content="#0d3b66" />
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='40' fill='%23ffcc80'/></svg>">
    <meta name="color-scheme" content="light dark" />
</svelte:head>

<main class="shell">
    <header class="header">
        <h1>Sunglow</h1>
        <p class="tagline">{mode === 'location' ? EVENT_COPY[selectedEvent].tagline : 'Will you see a sunset on your flight?'}</p>
    </header>

    <nav class="mode-toggle" aria-label="Prediction mode">
        <button class="toggle-btn" class:active={mode === 'location'} onclick={() => switchMode('location')}>Location</button>
        <button class="toggle-btn" class:active={mode === 'flight'} onclick={() => switchMode('flight')}>Flight</button>
    </nav>

    {#if mode === 'location'}
        <div class="mode-toggle event-toggle" role="group" aria-label="Sunset or sunrise">
            {#each SKY_EVENTS as event}
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
        {#if isLoading}
            <div class="loader" aria-live="polite">Loading prediction…</div>
        {:else if predictionData}
            <ResultsDisplay prediction={predictionData} {locationLabel} />
            {#if location}
                <PushSubscribeButton location={{ latitude: location.latitude, longitude: location.longitude, label: locationLabel }} event={selectedEvent} />
            {/if}
        {:else}
            <LocationInput {onLocationSuccess} {onLocationError} />
        {/if}
    {:else}
        {#if isFlightLoading}
            <div class="loader" aria-live="polite">Analyzing flight route…</div>
        {:else if flightPrediction}
            <FlightResultsDisplay prediction={flightPrediction} onBack={() => (flightPrediction = null)} />
        {:else}
            <FlightInput lookupAvailable={data.flightLookupAvailable} {onFlightSubmit} onSwitchMode={() => switchMode('location')} />
        {/if}
    {/if}

    {#if errorMessage}
        <p class="error" aria-live="polite">{errorMessage}</p>
    {/if}
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
    .tagline { margin: 0.25rem 0 0; opacity: 0.9; }
    .mode-toggle {
        display: flex;
        gap: 0;
        border-radius: 10px;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,0.18);
    }
    .toggle-btn {
        padding: 0.5rem 1.25rem;
        background: transparent;
        border: none;
        color: var(--text-primary);
        cursor: pointer;
        font-size: 0.95rem;
        opacity: 0.6;
        transition: opacity 0.2s, background 0.2s;
    }
    .toggle-btn.active {
        opacity: 1;
        background: rgba(255,255,255,0.12);
        font-weight: 600;
    }
    .toggle-btn:hover { opacity: 0.9; }
    .event-toggle { margin-top: -0.75rem; }
    .event-toggle .toggle-btn { font-size: 0.85rem; padding: 0.35rem 1rem; }
    .loader { opacity: 0.9; }
    .error { color: #ffd3d3; }
</style>

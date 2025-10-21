<script>
    import LocationInput from '$lib/components/LocationInput.svelte';
    import ResultsDisplay from '$lib/components/ResultsDisplay.svelte';
    let SunCalcPromise = null;

    export let data;
    let predictionData = null;
    let isLoading = false;
    let errorMessage = '';
    let location = null;
    let locationLabel = '';

    async function fetchPrediction(latitude, longitude) {
        isLoading = true;
        errorMessage = '';
        predictionData = null;

        try {
            const res = await fetch('/api/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ latitude, longitude })
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(errText || 'Prediction request failed');
            }

            const data = await res.json();
            // dynamic import to keep initial bundle smaller
            if (!SunCalcPromise) SunCalcPromise = import('suncalc');
            const { default: SunCalc } = await SunCalcPromise;
            const times = SunCalc.getTimes(new Date(), latitude, longitude);

            predictionData = {
                qualityScore: data?.qualityScore ?? 0,
                confidence: data?.confidence ?? undefined,
                explanation: data?.explanation ?? undefined,
                timings: {
                    sunset: times.sunset,
                    goldenHour: times.goldenHour
                }
            };

            updateTheme(predictionData.qualityScore);
            try { localStorage.setItem('sunglow:last', JSON.stringify({ latitude, longitude, label: locationLabel })); } catch {}
        } catch (err) {
            errorMessage = err?.message || 'An unexpected error occurred.';
        } finally {
            isLoading = false;
        }
    }

    async function onLocationSuccess(event) {
        const { latitude, longitude, label } = event.detail;
        location = { latitude, longitude };
        if (label) {
            locationLabel = label;
        } else {
            locationLabel = `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`; // temporary placeholder
            // reverse geocode for a friendly name
            try {
                const res = await fetch(`/api/reverse-geocode?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}`);
                if (res.ok) {
                    const data = await res.json();
                    locationLabel = data?.label || '';
                }
            } catch (e) {
                /* ignore */
            }
        }
        fetchPrediction(latitude, longitude);
    }

    function onLocationError(event) {
        errorMessage = event?.detail?.message || 'Failed to get location.';
    }

    function updateTheme(score) {
        const root = document.documentElement;
        const s = Number(score || 0);

        if (s > 75) {
            root.style.setProperty('--background-start', '#2c0a2c');
            root.style.setProperty('--background-end', '#6d2a49');
            root.style.setProperty('--text-primary', '#ffffff');
            root.style.setProperty('--text-accent', '#ffcc80');
            return;
        }
        if (s > 50) {
            root.style.setProperty('--background-start', '#0d3b66');
            root.style.setProperty('--background-end', '#f95738');
            root.style.setProperty('--text-primary', '#ffffff');
            root.style.setProperty('--text-accent', '#f4d35e');
            return;
        }
        if (s > 25) {
            root.style.setProperty('--background-start', '#4a6fa5');
            root.style.setProperty('--background-end', '#f7d08a');
            root.style.setProperty('--text-primary', '#16293a');
            root.style.setProperty('--text-accent', '#0f1a2b');
            return;
        }

        // Poor
        root.style.setProperty('--background-start', '#3e4a61');
        root.style.setProperty('--background-end', '#939fab');
        root.style.setProperty('--text-primary', '#e0e0e0');
        root.style.setProperty('--text-accent', '#ffffff');
    }
    // Note: we no longer auto-load the last location on mount so that a reload returns to the search view.
</script>

<svelte:head>
    <title>Sunglow — Sunset Quality Prediction</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Predict sunset quality with real-time weather and solar timings." />
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="preconnect" href="https://api.open-meteo.com" crossorigin>
    <link rel="preconnect" href="https://geocoding-api.open-meteo.com" crossorigin>
    <link rel="preconnect" href="https://api.bigdatacloud.net" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
    <meta name="theme-color" content="#000000" />
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='40' fill='%23ffcc80'/></svg>">
    <meta name="color-scheme" content="light dark" />
    <meta http-equiv="x-ua-compatible" content="ie=edge" />
    <meta name="HandheldFriendly" content="true" />
</svelte:head>

<main class="shell">
    <header class="header">
        <h1>Sunglow</h1>
        <p class="tagline">Predict tonight's sunset quality</p>
    </header>

    {#if isLoading}
        <div class="loader" aria-live="polite">Loading prediction…</div>
    {:else if predictionData}
        <ResultsDisplay prediction={predictionData} locationLabel={locationLabel} confidence={predictionData?.confidence} />
    {:else}
        <LocationInput on:locationSuccess={onLocationSuccess} on:locationError={onLocationError} />
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
    .loader { opacity: 0.9; }
    .error { color: #ffd3d3; }
</style>

{#if !predictionData && data?.ssr}
    <script>
        // hydrate preloaded SSR result after first paint
        location = { latitude: data.ssr.latitude, longitude: data.ssr.longitude };
        locationLabel = data.ssr.label || '';
        predictionData = { qualityScore: data.ssr.qualityScore, confidence: data.ssr.confidence, timings: { sunset: null, goldenHour: null } };
        // compute times lazily on client
        (async () => {
            if (!SunCalcPromise) SunCalcPromise = import('suncalc');
            const { default: SunCalc } = await SunCalcPromise;
            const times = SunCalc.getTimes(new Date(), data.ssr.latitude, data.ssr.longitude);
            predictionData = { ...predictionData, timings: { sunset: times.sunset, goldenHour: times.goldenHour } };
            updateTheme(predictionData.qualityScore);
            try { localStorage.setItem('sunglow:last', JSON.stringify({ latitude: data.ssr.latitude, longitude: data.ssr.longitude, label: locationLabel })); } catch {}
        })();
    </script>
{/if}



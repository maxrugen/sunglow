<script lang="ts">
    import Combobox from './Combobox.svelte';

    type GeocodeResult = { latitude: number; longitude: number; name: string; admin1?: string; country: string };

    interface Props {
        onLocationSuccess: (location: { latitude: number; longitude: number; label?: string }) => void;
    }

    let { onLocationSuccess }: Props = $props();

    let city: string = $state('');
    let results: GeocodeResult[] = $state([]);
    let isSearching: boolean = $state(false);
    let isLocating: boolean = $state(false);
    let errorMessage: string = $state('');
    let resultsStatus: string = $state('');
    let debounceHandle: ReturnType<typeof setTimeout>;
    let searchSeq = 0;

    function select(r: GeocodeResult) {
        results = [];
        onLocationSuccess({ latitude: r.latitude, longitude: r.longitude, label: `${r.name}${r.admin1 ? `, ${r.admin1}` : ''}, ${r.country}` });
    }

    function onSubmit(e: SubmitEvent) {
        e.preventDefault();
        clearTimeout(debounceHandle);
        searchCity();
    }

    async function searchCity() {
        const q = city.trim();
        if (!q) {
            results = [];
            resultsStatus = '';
            return;
        }
        // Only the latest search may update the list, even if answers arrive out of order.
        const seq = ++searchSeq;
        isSearching = true;
        errorMessage = '';
        try {
            const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
            if (!res.ok) throw new Error('City search is unavailable right now. Try again in a moment.');
            const data = await res.json();
            if (seq !== searchSeq) return;
            results = data?.results || [];
            resultsStatus = results.length ? `${results.length} result${results.length === 1 ? '' : 's'} found` : '';
            if (results.length === 0) errorMessage = `No places found for “${q}”.`;
        } catch (e) {
            if (seq !== searchSeq) return;
            results = [];
            errorMessage = e instanceof TypeError ? "Can't reach Sunglow right now. Check your connection." : (e as Error).message;
        } finally {
            if (seq === searchSeq) isSearching = false;
        }
    }

    function onInput() {
        clearTimeout(debounceHandle);
        debounceHandle = setTimeout(searchCity, 300);
    }

    function useMyLocation() {
        errorMessage = '';
        if (!('geolocation' in navigator)) {
            errorMessage = 'Location isn’t available in this browser. Search for a city instead.';
            return;
        }

        isLocating = true;
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                isLocating = false;
                const { latitude, longitude } = pos.coords;
                onLocationSuccess({ latitude, longitude });
            },
            (err) => {
                isLocating = false;
                errorMessage =
                    err?.code === err?.PERMISSION_DENIED
                        ? 'Location access was denied. Allow it in your browser settings, or search for a city.'
                        : 'Couldn’t get your location. Try again, or search for a city.';
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }
</script>

<div class="location-input">
    <form class="controls" onsubmit={onSubmit}>
        <div class="search">
            <Combobox
                id="city-input"
                label="City name"
                labelHidden
                placeholder="Enter a city"
                bind:value={city}
                items={results}
                status={resultsStatus}
                onInput={onInput}
                onSelect={select}
            >
                {#snippet option(r)}
                    <span>{r.name}</span>
                    <small>{r.admin1 ? `${r.admin1}, ` : ''}{r.country}</small>
                {/snippet}
            </Combobox>
        </div>
        <button class="btn" type="submit" disabled={isLocating || isSearching}>
            {isSearching ? 'Searching…' : 'Search'}
        </button>
        <button class="btn primary" type="button" onclick={useMyLocation} disabled={isLocating}>
            {isLocating ? 'Locating…' : 'Use My Location'}
        </button>
    </form>

    <!-- Stays mounted so new errors are announced. -->
    <p class="error-text error" role="alert">{errorMessage}</p>
</div>

<style>
    .location-input { width: 100%; max-width: 640px; }
    .controls { display: flex; gap: 0.75rem; width: 100%; }
    .search { flex: 1; }
    .btn { border-color: var(--text-accent); }
    .error { margin: 0.75rem 0 0; }
    .error:empty { margin: 0; }

    @media (max-width: 520px) {
        .controls { flex-direction: column; }
        .btn { width: 100%; }
    }
</style>

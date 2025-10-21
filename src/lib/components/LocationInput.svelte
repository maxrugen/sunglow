<script lang="ts">
    import { createEventDispatcher } from 'svelte';

    type LocationSuccessDetail = { latitude: number; longitude: number; label?: string };
    type LocationErrorDetail = { message: string };
    const dispatch = createEventDispatcher<{ locationSuccess: LocationSuccessDetail; locationError: LocationErrorDetail }>();

    let city: string = '';
    let results: any[] = [];
    let isSearching: boolean = false;
    let isLocating: boolean = false;
    let errorMessage: string = '';
    let activeIndex: number = -1;
    let debounceHandle: any;
    let rootEl: HTMLDivElement;

    async function searchCity() {
        errorMessage = '';
        results = [];
        const q = city.trim();
        if (!q) return;
        isSearching = true;
        try {
            const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
            if (!res.ok) throw new Error('Failed to search city');
            const data = await res.json();
            results = data?.results || [];
            if (results.length === 0) {
                errorMessage = 'No results found.';
            }
        } catch (e) {
            errorMessage = e instanceof Error ? e.message : 'Failed to search city';
        } finally {
            isSearching = false;
        }
    }

    function onInput(e: Event) {
        city = (e.currentTarget as HTMLInputElement).value;
        activeIndex = -1;
        clearTimeout(debounceHandle);
        debounceHandle = setTimeout(() => {
            searchCity();
        }, 300);
    }

    function onKeyDown(e: KeyboardEvent) {
        if (!results || results.length === 0) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIndex = (activeIndex + 1) % results.length;
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIndex = (activeIndex - 1 + results.length) % results.length;
        } else if (e.key === 'Enter' && activeIndex >= 0) {
            e.preventDefault();
            const r = results[activeIndex];
            dispatch('locationSuccess', { latitude: r.latitude, longitude: r.longitude, label: `${r.name}${r.admin1 ? `, ${r.admin1}` : ''}, ${r.country}` });
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeResults();
        }
    }

    function closeResults() {
        results = [];
        activeIndex = -1;
    }

    function onWindowClick(e: MouseEvent) {
        if (!rootEl) return;
        const t = e.target as Node | null;
        if (t && !rootEl.contains(t)) {
            closeResults();
        }
    }

    function useMyLocation() {
        errorMessage = '';
        if (!('geolocation' in navigator)) {
            errorMessage = 'Geolocation is not supported by your browser.';
            dispatch('locationError', { message: errorMessage });
            return;
        }

        isLocating = true;
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                isLocating = false;
                const { latitude, longitude } = pos.coords;
                dispatch('locationSuccess', { latitude, longitude });
            },
            (err) => {
                isLocating = false;
                errorMessage = err?.message || 'Failed to retrieve your location.';
                dispatch('locationError', { message: errorMessage });
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }
</script>

<svelte:window on:click={onWindowClick} />
<div class="location-input" bind:this={rootEl}>
    <form class="controls" on:submit|preventDefault={searchCity}>
        <input
            type="text"
            placeholder="Enter a city"
            bind:value={city}
            aria-label="City name"
            aria-controls="search-results"
            on:input={onInput}
            on:keydown={onKeyDown}
        />
        <button class="btn" type="submit" disabled={isLocating || isSearching}>
            {#if isSearching}
                Searching...
            {:else}
                Search
            {/if}
        </button>
        <button class="btn primary" on:click={useMyLocation} disabled={isLocating}>
            {#if isLocating}
                Locating...
            {:else}
                Use My Location
            {/if}
        </button>
    </form>

    {#if errorMessage}
        <p class="error" aria-live="polite">{errorMessage}</p>
    {/if}

    {#if results.length > 0}
        <p class="visually-hidden" aria-live="polite">{results.length} result{results.length === 1 ? '' : 's'} found</p>
        <ul class="results" role="listbox" id="search-results">
            {#each results as r}
                <li>
                    <button
                        type="button"
                        class="result"
                        class:active={activeIndex >= 0 && results[activeIndex] === r}
                        role="option"
                        aria-selected={activeIndex >= 0 && results[activeIndex] === r ? 'true' : 'false'}
                        on:click={() => dispatch('locationSuccess', { latitude: r.latitude, longitude: r.longitude, label: `${r.name}${r.admin1 ? `, ${r.admin1}` : ''}, ${r.country}` })}
                    >
                        <span>{r.name}</span>
                        <small>{r.admin1 ? `${r.admin1}, ` : ''}{r.country}</small>
                    </button>
                </li>
            {/each}
        </ul>
    {/if}
</div>

<style>
    .location-input { width: 100%; max-width: 640px; }
    .controls { display: flex; gap: 0.75rem; width: 100%; }
    input {
        flex: 1;
        padding: 0.75rem 1rem;
        border-radius: 10px;
        border: 1px solid var(--text-accent);
        background: rgba(255,255,255,0.08);
        color: var(--text-primary);
        outline: none;
        backdrop-filter: blur(8px);
    }
    input::placeholder { color: rgba(255,255,255,0.7); }
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
    .btn.primary { border-color: var(--text-accent); color: var(--text-primary); }
    .error { margin-top: 0.75rem; color: #ffd3d3; }
    .results { margin: 0.75rem 0 0; padding: 0; list-style: none; display: grid; gap: 0.5rem; }
    .result { width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 0.75rem; border-radius: 10px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14); cursor: pointer; color: var(--text-primary); }
    .result:hover { background: rgba(255,255,255,0.14); }
    .result.active { border-color: var(--text-accent); background: rgba(255,255,255,0.14); }

    @media (max-width: 520px) {
        .controls { flex-direction: column; }
        .btn { width: 100%; }
    }
</style>



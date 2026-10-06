<script lang="ts">
    type GeocodeResult = { latitude: number; longitude: number; name: string; admin1?: string; country: string };

    interface Props {
        onLocationSuccess: (location: { latitude: number; longitude: number; label?: string }) => void;
        onLocationError: (error: { message: string }) => void;
    }

    let { onLocationSuccess, onLocationError }: Props = $props();

    let city: string = $state('');
    let results: GeocodeResult[] = $state([]);
    let isSearching: boolean = $state(false);
    let isLocating: boolean = $state(false);
    let errorMessage: string = $state('');
    let activeIndex: number = $state(-1);
    let debounceHandle: ReturnType<typeof setTimeout>;
    let rootEl: HTMLDivElement | undefined = $state();
    let inputEl: HTMLInputElement | undefined = $state();

    function select(r: GeocodeResult) {
        onLocationSuccess({ latitude: r.latitude, longitude: r.longitude, label: `${r.name}${r.admin1 ? `, ${r.admin1}` : ''}, ${r.country}` });
    }

    function onSubmit(e: SubmitEvent) {
        e.preventDefault();
        searchCity();
    }

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
            // ensure an initial active option for keyboard users
            if (results.length > 0 && activeIndex === -1) activeIndex = 0;
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
            select(results[activeIndex]);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeResults();
        }
    }

    function closeResults() {
        results = [];
        activeIndex = -1;
        // keep focus on the input for continuity
        inputEl?.focus();
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
            onLocationError({ message: errorMessage });
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
                errorMessage = err?.message || 'Failed to retrieve your location.';
                onLocationError({ message: errorMessage });
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }
</script>

<svelte:window onclick={onWindowClick} />
<div class="location-input" bind:this={rootEl}>
    <form class="controls" onsubmit={onSubmit}>
        <input
            type="text"
            placeholder="Enter a city"
            bind:value={city}
            aria-label="City name"
            aria-controls="search-results"
            oninput={onInput}
            onkeydown={onKeyDown}
            bind:this={inputEl}
        />
        <button class="btn" type="submit" disabled={isLocating || isSearching}>
            {#if isSearching}
                Searching...
            {:else}
                Search
            {/if}
        </button>
        <button class="btn primary" onclick={useMyLocation} disabled={isLocating}>
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
            {#each results as r, i}
                <li>
                    <button
                        type="button"
                        class="result"
                        class:active={i === activeIndex}
                        role="option"
                        aria-selected={i === activeIndex}
                        onclick={() => select(r)}
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
    .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

    @media (max-width: 520px) {
        .controls { flex-direction: column; }
        .btn { width: 100%; }
    }
</style>



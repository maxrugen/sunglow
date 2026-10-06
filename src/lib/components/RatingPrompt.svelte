<script lang="ts">
    import { onMount } from 'svelte';
    import { deviceId, dueRating, forgetRating, type PendingRating } from '$lib/rating-store';
    import { errorMessageFrom } from '$lib/http';

    const CHOICES = [
        { value: 1, label: 'Dull' },
        { value: 2, label: 'Meh' },
        { value: 3, label: 'Nice' },
        { value: 4, label: 'Great' },
        { value: 5, label: 'Spectacular' }
    ];

    let pending: PendingRating | null = $state(null);
    let status: 'idle' | 'sending' | 'thanks' | 'error' = $state('idle');
    let message = $state('');

    onMount(() => {
        pending = dueRating();
    });

    async function rate(value: number) {
        if (!pending) return;
        status = 'sending';
        try {
            const res = await fetch('/api/ratings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: pending.token, rating: value, deviceId: deviceId() })
            });
            if (res.status === 410) {
                // The rating window closed meanwhile: nothing was saved and nothing is left to ask.
                forgetRating(pending);
                pending = null;
                return;
            }
            if (!res.ok) throw new Error(await errorMessageFrom(res, 'Could not save rating.'));
            forgetRating(pending);
            status = 'thanks';
        } catch (e) {
            status = 'error';
            message = e instanceof Error ? e.message : 'Could not save rating.';
        }
    }

    function dismiss() {
        if (pending) forgetRating(pending);
        pending = null;
    }
</script>

{#if pending}
    <section class="rating" aria-labelledby="rating-title">
        {#if status === 'thanks'}
            <p class="rating-title" aria-live="polite">Thanks! This helps tune future predictions.</p>
        {:else}
            <p class="rating-title" id="rating-title">
                How was the sunset in {pending.label}?
                <small>We predicted {pending.predictedScore}%.</small>
            </p>
            <div class="choices" role="group" aria-label="Rate the sunset">
                {#each CHOICES as choice}
                    <button
                        type="button"
                        class="choice"
                        disabled={status === 'sending'}
                        aria-label={`${choice.value} of 5: ${choice.label}`}
                        onclick={() => rate(choice.value)}
                    >
                        <span aria-hidden="true">{'★'.repeat(choice.value)}</span>
                        <small>{choice.label}</small>
                    </button>
                {/each}
            </div>
            <button type="button" class="skip" onclick={dismiss}>I didn't see it</button>
            {#if status === 'error'}
                <p class="rating-error" aria-live="polite">{message}</p>
            {/if}
        {/if}
    </section>
{/if}

<style>
    .rating {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.6rem;
        padding: 0.9rem 1rem;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(255, 255, 255, 0.08);
        max-width: 34rem;
        width: 100%;
    }
    .rating-title {
        margin: 0;
        text-align: center;
        font-weight: 600;
    }
    .rating-title small {
        display: block;
        font-weight: 400;
        opacity: 0.8;
    }
    .choices {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 0.4rem;
    }
    .choice {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.1rem;
        padding: 0.45rem 0.6rem;
        min-width: 4.5rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.25);
        background: rgba(255, 255, 255, 0.1);
        color: var(--text-primary);
        cursor: pointer;
        font-size: 0.8rem;
        transition: background 0.2s;
    }
    .choice span {
        color: var(--text-accent);
        letter-spacing: -0.05em;
    }
    .choice:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.2);
    }
    .choice:disabled {
        opacity: 0.6;
        cursor: default;
    }
    .skip {
        background: transparent;
        border: none;
        color: var(--text-primary);
        opacity: 0.75;
        cursor: pointer;
        font-size: 0.85rem;
    }
    .skip:hover {
        opacity: 1;
    }
    .rating-error {
        margin: 0;
        color: #ffd3d3;
        font-size: 0.85rem;
    }
</style>

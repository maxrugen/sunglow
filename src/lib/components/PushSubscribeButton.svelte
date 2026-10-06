<script lang="ts">
    import { onMount } from 'svelte';
    import { env } from '$env/dynamic/public';
    import { EVENT_COPY, SKY_EVENTS } from '$lib/events';
    import type { SkyEvent } from '$lib/types';

    interface Props {
        /** The location to attach to the subscription (from the current prediction). */
        location?: { latitude: number; longitude: number; label?: string } | null;
        /** Event currently shown; a new subscription alerts on this one. */
        event?: SkyEvent;
    }

    let { location = null, event = 'sunset' }: Props = $props();

    type Status = 'loading' | 'unsupported' | 'ios-install' | 'default' | 'denied' | 'subscribed';
    type AlertEvents = Record<SkyEvent, boolean>;
    let status: Status = $state('loading');
    let message = $state('');
    // Mirrors the server-side flags; subscriptions from before sunrise alerts are sunset-only.
    const ALERTS_KEY = 'sunglow:alerts';
    let alertEvents: AlertEvents = $state({ sunset: true, sunrise: false });
    let alertLabel = $state('');

    function saveAlerts(events: AlertEvents, label = alertLabel) {
        alertEvents = events;
        alertLabel = label;
        try { localStorage.setItem(ALERTS_KEY, JSON.stringify({ ...events, label })); } catch { /* storage unavailable */ }
    }

    const vapid = env.PUBLIC_VAPID_PUBLIC_KEY;

    function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = atob(base64);
        const arr = new Uint8Array(new ArrayBuffer(raw.length));
        for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
        return arr;
    }

    function pushHeaders(): Record<string, string> {
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        const token = env.PUBLIC_SUBSCRIBE_TOKEN;
        if (token) headers.authorization = `Bearer ${token}`;
        return headers;
    }

    function savedLocation(): { latitude: number; longitude: number; label?: string } | null {
        if (location) return location;
        try {
            const raw = localStorage.getItem('sunglow:last');
            if (raw) return JSON.parse(raw);
        } catch {
            /* ignore */
        }
        return null;
    }

    onMount(async () => {
        const isStandalone =
            window.matchMedia('(display-mode: standalone)').matches ||
            (window.navigator as { standalone?: boolean }).standalone === true;
        const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

        if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
            // On iOS, Push is only exposed once the app is installed to the Home Screen.
            status = isIOS && !isStandalone ? 'ios-install' : 'unsupported';
            return;
        }
        if (Notification.permission === 'denied') {
            status = 'denied';
            return;
        }
        try {
            const stored = JSON.parse(localStorage.getItem(ALERTS_KEY) ?? 'null');
            if (stored) {
                alertEvents = { sunset: stored.sunset === true, sunrise: stored.sunrise === true };
                alertLabel = typeof stored.label === 'string' ? stored.label : '';
            }
        } catch { /* storage unavailable or corrupt */ }
        try {
            const reg = await navigator.serviceWorker.getRegistration();
            const sub = reg ? await reg.pushManager.getSubscription() : null;
            status = sub ? 'subscribed' : 'default';
        } catch {
            status = 'default';
        }
    });

    async function subscribe() {
        message = '';
        if (!vapid) {
            message = "Push isn't configured (missing VAPID public key).";
            return;
        }
        const loc = savedLocation();
        if (!loc) {
            message = 'Pick a location first, then enable alerts for it.';
            return;
        }
        status = 'loading';
        try {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                status = permission === 'denied' ? 'denied' : 'default';
                message = 'Notification permission was not granted.';
                return;
            }
            // SvelteKit registers the service worker on load; wait for it to activate.
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(vapid)
            });
            const events: AlertEvents = { sunset: event === 'sunset', sunrise: event === 'sunrise' };
            const res = await fetch('/api/push/subscribe', {
                method: 'POST',
                headers: pushHeaders(),
                body: JSON.stringify({
                    subscription: sub.toJSON(),
                    latitude: loc.latitude,
                    longitude: loc.longitude,
                    label: loc.label ?? null,
                    events
                })
            });
            if (!res.ok) throw new Error('server rejected the subscription');
            saveAlerts(events, loc.label ?? '');
            status = 'subscribed';
            message = `Subscribed — ${EVENT_COPY[event].noun} alerts will arrive on this device.`;
        } catch (e) {
            status = 'default';
            message = `Could not subscribe: ${(e as Error).message}`;
        }
    }

    /** Switch one event on or off; turning off the last one unsubscribes. */
    async function toggleEvent(e: SkyEvent) {
        const next: AlertEvents = { ...alertEvents, [e]: !alertEvents[e] };
        if (!next.sunset && !next.sunrise) return unsubscribe();
        message = '';
        const previous = alertEvents;
        alertEvents = next;
        try {
            const reg = await navigator.serviceWorker.getRegistration();
            const sub = reg ? await reg.pushManager.getSubscription() : null;
            if (!sub) throw new Error('no subscription on this device');
            // Only the flags change; the alert location stays the one chosen when subscribing.
            const res = await fetch('/api/push/preferences', {
                method: 'POST',
                headers: pushHeaders(),
                body: JSON.stringify({ endpoint: sub.endpoint, events: next })
            });
            if (!res.ok) throw new Error('server rejected the change');
            saveAlerts(next);
        } catch (err) {
            alertEvents = previous;
            message = `Could not update alerts: ${(err as Error).message}`;
        }
    }

    async function unsubscribe() {
        message = '';
        status = 'loading';
        try {
            const reg = await navigator.serviceWorker.getRegistration();
            const sub = reg ? await reg.pushManager.getSubscription() : null;
            if (sub) {
                await fetch('/api/push/unsubscribe', {
                    method: 'POST',
                    headers: pushHeaders(),
                    body: JSON.stringify({ endpoint: sub.endpoint })
                });
                await sub.unsubscribe();
            }
            try { localStorage.removeItem(ALERTS_KEY); } catch { /* storage unavailable */ }
            status = 'default';
            message = 'Unsubscribed on this device.';
        } catch {
            status = 'subscribed';
            message = 'Could not unsubscribe.';
        }
    }
</script>

<div class="push">
    {#if status === 'loading'}
        <button class="push-btn" disabled>…</button>
    {:else if status === 'ios-install'}
        <p class="push-hint">
            On iPhone, tap <strong>Share → Add to Home Screen</strong>, then open Sunglow from the
            Home Screen and return here to enable alerts.
        </p>
    {:else if status === 'unsupported'}
        <p class="push-hint">Push notifications aren’t supported in this browser.</p>
    {:else if status === 'denied'}
        <p class="push-hint">
            Notifications are blocked. Enable them for this site in your browser or OS settings, then
            reload.
        </p>
    {:else if status === 'subscribed'}
        <fieldset class="push-events">
            <legend>Alerts on this device{alertLabel ? ` for ${alertLabel}` : ''}</legend>
            {#each SKY_EVENTS as e (e)}
                <label>
                    <input type="checkbox" checked={alertEvents[e]} onchange={() => toggleEvent(e)} />
                    {EVENT_COPY[e].icon} {EVENT_COPY[e].title}s
                </label>
            {/each}
        </fieldset>
        <button class="push-btn" onclick={unsubscribe}>🔕 Turn off all alerts</button>
    {:else}
        <button class="push-btn" onclick={subscribe}>🔔 Alert me for great {EVENT_COPY[event].noun}s here</button>
    {/if}

    {#if message}
        <p class="push-msg" aria-live="polite">{message}</p>
    {/if}
</div>

<style>
    .push {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        margin-top: 1rem;
    }
    .push-btn {
        padding: 0.6rem 1.1rem;
        border-radius: 10px;
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text-primary);
        cursor: pointer;
        font-size: 0.95rem;
        transition: background 0.2s, opacity 0.2s;
    }
    .push-btn:hover:not(:disabled) {
        filter: brightness(1.15);
    }
    .push-btn:disabled {
        opacity: 0.6;
        cursor: default;
    }
    .push-events {
        display: flex;
        gap: 1rem;
        justify-content: center;
        border: none;
        margin: 0;
        padding: 0;
        font-size: 0.9rem;
    }
    .push-events legend {
        width: 100%;
        text-align: center;
        font-size: 0.85rem;
        margin-bottom: 0.35rem;
    }
    .push-events label {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        cursor: pointer;
    }
    .push-hint,
    .push-msg {
        margin: 0;
        max-width: 32ch;
        text-align: center;
        font-size: 0.85rem;
    }
</style>

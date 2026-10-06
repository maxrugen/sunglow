<script lang="ts">
    import { onMount } from 'svelte';
    import { env } from '$env/dynamic/public';

    interface Props {
        /** The location to attach to the subscription (from the current prediction). */
        location?: { latitude: number; longitude: number; label?: string } | null;
    }

    let { location = null }: Props = $props();

    type Status = 'loading' | 'unsupported' | 'ios-install' | 'default' | 'denied' | 'subscribed';
    let status: Status = $state('loading');
    let message = $state('');

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
            const res = await fetch('/api/push/subscribe', {
                method: 'POST',
                headers: pushHeaders(),
                body: JSON.stringify({
                    subscription: sub.toJSON(),
                    latitude: loc.latitude,
                    longitude: loc.longitude,
                    label: loc.label ?? null
                })
            });
            if (!res.ok) throw new Error('server rejected the subscription');
            status = 'subscribed';
            message = 'Subscribed — sunset alerts will arrive on this device.';
        } catch (e) {
            status = 'default';
            message = `Could not subscribe: ${(e as Error).message}`;
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
        <button class="push-btn" onclick={unsubscribe}>🔕 Disable sunset alerts</button>
    {:else}
        <button class="push-btn" onclick={subscribe}>🔔 Alert me for great sunsets here</button>
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
        border: 1px solid rgba(255, 255, 255, 0.25);
        background: rgba(255, 255, 255, 0.12);
        color: var(--text-primary);
        cursor: pointer;
        font-size: 0.95rem;
        transition: background 0.2s, opacity 0.2s;
    }
    .push-btn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.2);
    }
    .push-btn:disabled {
        opacity: 0.6;
        cursor: default;
    }
    .push-hint,
    .push-msg {
        margin: 0;
        max-width: 32ch;
        text-align: center;
        font-size: 0.85rem;
        opacity: 0.85;
    }
</style>

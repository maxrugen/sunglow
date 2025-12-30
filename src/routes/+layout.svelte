<script>
    import { injectAnalytics } from '@vercel/analytics/sveltekit';
    import '../app.css';
    
    injectAnalytics();

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js').catch(() => {});
        });
    }
</script>

<slot />



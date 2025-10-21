<script>
    import '../app.css';
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js').catch(() => {});
        });
    }
</script>

<slot />



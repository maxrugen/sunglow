<script lang="ts">
    import type { Snippet } from 'svelte';
    import '@fontsource-variable/inter';
    import '../app.css';
    // SvelteKit registers src/service-worker.ts automatically.

    let { children }: { children: Snippet } = $props();
</script>

{@render children()}

import { dev } from '$app/env';
// The generic entry: `@vercel/analytics/sveltekit` imports `$app/stores`, which SvelteKit 3 removed.
// It tracks client-side navigations on its own.
import { inject } from '@vercel/analytics';

inject({ mode: dev ? 'development' : 'production' });

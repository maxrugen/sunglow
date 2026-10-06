import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * Every variable is optional: features switch off (push, ratings, flight
 * search) or fall back to defaults in code when one is missing, so the app
 * still runs with no configuration. See .env.example for what each one does.
 */
const optional = (value: string | undefined) => value;

export const variables = defineEnvVars({
  DATABASE_URL: { schema: optional, description: 'Neon Postgres connection string (push subscriptions, ratings).' },
  VAPID_PUBLIC_KEY: { schema: optional, description: 'Web Push VAPID public key.' },
  VAPID_PRIVATE_KEY: { schema: optional, description: 'Web Push VAPID private key.' },
  VAPID_SUBJECT: { schema: optional, description: 'Web Push contact, e.g. mailto:…' },
  PUBLIC_VAPID_PUBLIC_KEY: { public: true, schema: optional, description: 'Same as VAPID_PUBLIC_KEY, for the browser.' },
  CRON_SECRET: { schema: optional, description: 'Bearer token for /api/cron. Required outside local dev.' },
  APP_URL: { schema: optional, description: 'Public origin for notification links (falls back to the request origin).' },
  SUBSCRIBE_TOKEN: { schema: optional, description: 'Deterrent token for /api/push/*.' },
  PUBLIC_SUBSCRIBE_TOKEN: { public: true, schema: optional, description: 'Same as SUBSCRIBE_TOKEN, for the browser.' },
  RATING_SECRET: { schema: optional, description: 'Signs prediction snapshots for ratings.' },
  SUNSET_SCORE_MIN: { schema: optional, description: 'Minimum score for an alert (default 80).' },
  SUNSET_CONFIDENCE_MIN: { schema: optional, description: 'Minimum confidence for an alert (default 70).' },
  NOTIFY_LEAD_HOURS: { schema: optional, description: 'Sunset alert lead time in hours (default 2).' },
  SUNRISE_EVENING_HOUR: { schema: optional, description: 'Local hour for the evening-before sunrise alert (default 20).' },
  SUNRISE_LEAD_HOURS: { schema: optional, description: 'Sunrise alert lead time in hours (default 1).' },
  AIRLABS_API_KEY: { schema: optional, description: 'AirLabs key for finding flights by number or route.' },
});

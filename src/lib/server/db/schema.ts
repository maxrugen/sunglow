import {
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Web Push subscriptions — one row per installed device. Extends the plain
 * subscription with the location the user wants sunset alerts for, plus a
 * dedup key so the cron sends at most one notification per location per day.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: serial('id').primaryKey(),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    label: text('label'),
    userAgent: text('user_agent'),
    /** YYYY-MM-DD of the last sunset we notified about (dedup key). */
    lastNotifiedDate: text('last_notified_date'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('push_endpoint_uq').on(t.endpoint)]
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

/**
 * "How was it?" ratings, stored with a snapshot of what the model saw, so the
 * scoring coefficients can be calibrated against real observations later.
 */
export const sunsetRatings = pgTable(
  'sunset_ratings',
  {
    id: serial('id').primaryKey(),
    /** Random per-browser id, so each device rates a given sunset once. */
    deviceId: text('device_id').notNull(),
    /** Rounded to 2 decimals (~1 km). */
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    sunsetAt: ts('sunset_at').notNull(),
    /** 1–5 stars. */
    rating: smallint('rating').notNull(),
    predictedScore: smallint('predicted_score').notNull(),
    confidence: smallint('confidence').notNull(),
    /** SCORING_VERSION that produced predictedScore. */
    scoringVersion: integer('scoring_version').notNull(),
    /** WeatherData inputs as scored. */
    weather: jsonb('weather').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sunset_rating_device_uq').on(t.deviceId, t.sunsetAt, t.latitude, t.longitude)]
);

export type SunsetRatingRow = typeof sunsetRatings.$inferSelect;

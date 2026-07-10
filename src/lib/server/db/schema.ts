import {
  doublePrecision,
  pgTable,
  serial,
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

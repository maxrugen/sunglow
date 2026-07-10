import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

export type DB = NeonHttpDatabase<typeof schema>;

let instance: DB | null = null;

function init(): DB {
  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Add a Neon connection string to .env.local ' +
        '(or the Vercel project) — see .env.example.'
    );
  }
  return drizzle(neon(url), { schema });
}

/**
 * Lazily-initialized Drizzle client. The Neon connection is only created on
 * first query, so importing this module never requires DATABASE_URL — that
 * keeps `vite build` working without a database.
 */
export const db = new Proxy({} as DB, {
  get(_target, prop, receiver) {
    if (!instance) instance = init();
    const value = Reflect.get(instance as object, prop, receiver);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});

export { schema };

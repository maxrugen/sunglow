import { defineConfig } from 'drizzle-kit';

// Load .env.local for local drizzle-kit runs (generate/push).
try {
  process.loadEnvFile('.env.local');
} catch {
  // no .env.local — rely on the ambient environment
}

export default defineConfig({
  schema: './src/lib/server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});

import { defineConfig } from 'drizzle-kit'

/**
 * Drizzle Kit configuration.
 *
 * Schema changes are pushed with `npm run db:push`. There is no migration
 * history in this repository — see docs/database.md if you need to adopt
 * migrations instead.
 */
export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
})
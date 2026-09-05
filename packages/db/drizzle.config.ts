import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit generates migration SQL from `src/schema`. Migrations are
 * committed files applied by `pnpm db:migrate`; `drizzle-kit push` is
 * deliberately not used, because a schema that can drift without a versioned
 * migration cannot be reproduced in another environment.
 *
 * `DATABASE_URL` is the only connection setting, and generation does not need
 * it at all — it is declared here for the introspection commands that do.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/*.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
  dbCredentials: { url: process.env['DATABASE_URL'] ?? '' },
});

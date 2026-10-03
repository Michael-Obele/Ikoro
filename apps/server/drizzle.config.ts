/**
 * drizzle-kit configuration.
 *
 * ── `DATABASE_URL` is read here, and it is fine ──────────────────────────────
 * This file is read by drizzle-kit and by nothing else. It never enters the
 * module graph that `vite build` walks, so a top-level read is correct — and it
 * is in fact REQUIRED: drizzle-kit's `migrate` needs the URL before it can
 * connect, and deferring it would just move the same error.
 *
 * The one that must stay lazy is `src/lib/db/index.ts`, because THAT is
 * imported by the app. The distinction is: config read by tooling is read
 * eagerly; config read by shipped code is read lazily.
 *
 * Never inline a connection string here. It is committed.
 */

import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;

export default defineConfig({
	dialect: 'postgresql',
	schema: './src/lib/db/schema.ts',
	out: './drizzle',

	// A placeholder is worse than an absent value: drizzle-kit would try to
	// connect to `<host>` and produce a network error that looks like Neon being
	// down.
	dbCredentials: {
		url: url && !url.includes('<') ? url : ''
	},

	strict: true,
	verbose: true
});

/**
 * drizzle-kit config — read by drizzle-kit only, never by `vite build`, so the top-level URL read is safe.
 * Never inline a connection string here; the file is committed.
 */

import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;

export default defineConfig({
	dialect: 'postgresql',
	schema: './src/lib/db/schema.ts',
	out: './drizzle',

	// A placeholder makes drizzle-kit dial `<host>` and report a network error that
	// looks like Neon being down.
	dbCredentials: {
		url: url && !url.includes('<') ? url : ''
	},

	strict: true,
	verbose: true
});

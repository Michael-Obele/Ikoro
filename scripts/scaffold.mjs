#!/usr/bin/env node
/**
 * Ikoro — directory scaffolder (idempotent).
 *
 * Creates every directory the repository expects and drops a `.gitkeep` in each
 * leaf so the tree survives a clone (git does not track empty directories).
 *
 * Deliberately does NOT touch `docs/` or `plan/`: the plan is local-only and
 * gitignored, so a fresh clone has neither and needs neither.
 *
 * Safe to re-run at any time, including AFTER the generators run:
 *   sv create apps/app · sv create apps/landing · sv create apps/server
 *   cap add android · tauri init
 *
 * Usage:
 *   bun run scaffold          # create/repair the whole tree
 *   bun run scaffold -- --dry # list what would be created, change nothing
 *
 * Why this exists: `sv create`, `cap add` and `tauri init` all refuse to write
 * into a directory they consider non-empty. So the generators always run FIRST
 * (they own the top of each app), and this script fills in the inner folders
 * afterwards. It never overwrites a file that already exists.
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');

/** Directories that hold generated/tool-owned config at their root — never seed them. */
const TREES = {
	root: ['.github/workflows', '.vscode', 'scripts'],
	/**
	 * apps/app — the product. src-tauri/ and android/ are owned by
	 * `tauri init` and `cap add android`; we only pre-create their parents.
	 */
	'apps/app': [
		'apps/app/src/lib/db',
		'apps/app/src/lib/alarms',
		'apps/app/src/lib/sync',
		'apps/app/src/lib/components/task',
		'apps/app/src/lib/components/lists',
		'apps/app/src/lib/components/ui',
		'apps/app/src/lib/stores',
		'apps/app/src/lib/valibot',
		'apps/app/src/lib/utils',
		'apps/app/src/routes/today',
		'apps/app/src/routes/upcoming',
		'apps/app/src/routes/lists/[id]',
		'apps/app/src/routes/done',
		'apps/app/src/routes/settings',
		'apps/app/static/icons',
		'apps/app/tests'
	],
	'apps/landing': [
		'apps/landing/src/lib/components',
		'apps/landing/src/routes/download',
		'apps/landing/src/routes/privacy',
		'apps/landing/src/routes/changelog',
		'apps/landing/static'
	],
	'apps/server': [
		'apps/server/src/lib/auth',
		'apps/server/src/lib/db',
		'apps/server/src/routes/api/auth/[...all]',
		'apps/server/src/routes/api/v1/changes',
		'apps/server/src/routes/api/v1/stream',
		'apps/server/src/routes/api/v1/health',
		// Drizzle, not Prisma (D19). The schema itself is hand-authored at
		// src/lib/db/schema.ts and needs no directory of its own; this is where
		// `drizzle-kit generate` writes its SQL migrations.
		'apps/server/drizzle'
	],
	'packages/ui': ['packages/ui/src/lib/components/ui', 'packages/ui/src/lib/utils'],
	'packages/sync': ['packages/sync/src/lib', 'packages/sync/tests'],
	'packages/config': ['packages/config']
};

let dirs = 0;
let keeps = 0;

for (const paths of Object.values(TREES)) {
	for (const rel of paths) {
		const abs = join(ROOT, rel);
		const missing = !existsSync(abs);
		if (missing) {
			if (!DRY) mkdirSync(abs, { recursive: true });
			dirs++;
			console.log(`  + ${rel}/`);
		}
		// Seed a .gitkeep only where the directory is actually empty — never in a
		// directory a generator has already populated.
		//
		// In a dry run `missing` directories were never created, so readdirSync
		// would throw ENOENT on the first one it reports. A dry run exists to tell
		// you what a real run would do; it must not be the one command that
		// crashes when the tree is incomplete.
		if (!existsSync(abs)) continue;
		if (readdirSync(abs).length === 0) {
			const keep = join(abs, '.gitkeep');
			if (!DRY) writeFileSync(keep, '');
			keeps++;
		}
	}
}

console.log(
	`\n${DRY ? '[dry run] would create' : 'created'}: ${dirs} directories, ${keeps} .gitkeep markers.`
);

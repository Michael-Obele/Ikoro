#!/usr/bin/env node
/**
 * Ikoro — directory scaffolder (idempotent).
 *
 * Creates every directory the build plan expects and drops a `.gitkeep` in each
 * leaf so the tree survives a clone (git does not track empty directories).
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
	docs: ['docs/design', 'docs/build'],
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
		'apps/server/prisma'
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
		if (!existsSync(abs)) {
			if (!DRY) mkdirSync(abs, { recursive: true });
			dirs++;
			console.log(`  + ${rel}/`);
		}
		// Seed a .gitkeep only where the directory is actually empty — never in a
		// directory a generator has already populated.
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

#!/usr/bin/env node
/** Creates the directory tree and a `.gitkeep` in each empty leaf. Idempotent.
 *  Usage: `bun run scaffold [-- --dry]` — runs AFTER the generators, which refuse a non-empty dir. */
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');

/** Directories that hold generated/tool-owned config at their root — never seed them. */
const TREES = {
	root: ['.github/workflows', '.vscode', 'scripts'],
	/**
	 * apps/app — the product. src-tauri/ and android/ are owned by `tauri init`
	 * and `cap add android`; we only pre-create their parents.
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
		// Drizzle, not Prisma (D19); `drizzle-kit generate` writes its SQL migrations here.
		'apps/server/drizzle'
	],
	'packages/sync': ['packages/sync/src/lib', 'packages/sync/tests']
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
		// Seed .gitkeep only where empty. In a dry run `missing` dirs were never created,
		// so readdirSync would throw — hence the early continue below.
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

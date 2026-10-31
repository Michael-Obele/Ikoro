/**
 * Fetches shadcn-svelte components from the public registry — `bunx shadcn-svelte add` hangs here.
 * Usage: `bun scripts/fetch-shadcn.ts <component...>`
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const REGISTRY = 'https://shadcn-svelte.com/registry/styles/lyra';
const ROOT = resolve(import.meta.dir, '..');

/** components.json aliases → where files actually land on disk. */
const ALIASES: Record<string, string> = {
	components: 'src/lib/components',
	ui: 'src/lib/components/ui',
	lib: 'src/lib',
	hooks: 'src/lib/hooks',
	utils: 'src/lib/utils'
};

interface RegistryFile {
	/** Older items carry a full `$lib/...` path; current ones carry a `target`. */
	path?: string;
	target?: string;
	content: string;
	type?: string;
}

interface RegistryItem {
	name: string;
	dependencies?: string[];
	devDependencies?: string[];
	files: RegistryFile[];
	registryDependencies?: string[];
	cssVars?: { theme?: Record<string, string> };
}

/** Current registry items ship `target` relative to the `ui` alias. */
function resolvePath(file: RegistryFile): string {
	if (file.target) return join(ROOT, ALIASES.ui, file.target);
	if (!file.path) throw new Error(`${file.type ?? 'file'} entry has neither path nor target`);
	const [scope, ...rest] = file.path.split('/');
	const base = ALIASES[scope];
	return base ? join(ROOT, base, ...rest) : join(ROOT, file.path);
}

// The raw registry JSON ships `$UTILS$`-style placeholders verbatim; left alone
// they are broken imports, which is what keeps `bun run check` honest.
const PLACEHOLDERS: Record<string, string> = {
	$UTILS$: '$lib/utils',
	$UI$: '$lib/components/ui',
	$COMPONENTS$: '$lib/components',
	$HOOKS$: '$lib/hooks',
	'$ICON-PLACEHOLDER$': '$lib/components/icon-placeholder/icon-placeholder.svelte',
	$LIB$: '$lib'
};

function substitute(content: string): string {
	let out = content;
	for (const [token, alias] of Object.entries(PLACEHOLDERS)) {
		out = out.split(token).join(alias);
	}
	return out;
}

async function fetchItem(name: string): Promise<RegistryItem> {
	const res = await fetch(`${REGISTRY}/${name}.json`);
	if (!res.ok) throw new Error(`${name}: registry returned ${res.status}`);
	return (await res.json()) as RegistryItem;
}

const requested = process.argv.slice(2);
if (requested.length === 0) {
	console.error('usage: bun scripts/fetch-shadcn.ts <component...>');
	process.exit(1);
}

const seen = new Set<string>();
const queue = [...requested];
const deps = new Set<string>();

while (queue.length > 0) {
	const name = queue.shift()!;
	if (seen.has(name)) continue;
	seen.add(name);

	let item: RegistryItem;
	try {
		item = await fetchItem(name);
	} catch (err) {
		console.error(`  skip ${name} — ${(err as Error).message}`);
		continue;
	}

	for (const dep of [...(item.dependencies ?? []), ...(item.devDependencies ?? [])]) {
		const bare = dep.split('@')[0] ?? dep;
		if (!seen.has(bare)) deps.add(`${bare}@${dep.split('@').slice(1).join('@')}`);
	}
	for (const dep of item.registryDependencies ?? []) {
		if (!seen.has(dep)) queue.push(dep);
	}

	for (const file of item.files ?? []) {
		if (!file) continue;
		const target = resolvePath(file);
		await mkdir(dirname(target), { recursive: true });
		const body = substitute(file.content);
		await writeFile(target, body.endsWith('\n') ? body : `${body}\n`, 'utf8');
		console.log(`  ✓ ${target.replace(`${ROOT}/`, '')}`);
	}

	for (const [key, value] of Object.entries(item.cssVars?.theme ?? {})) {
		console.log(`  ! css var ${key} = ${value} — confirm it is already in src/routes/layout.css`);
	}
}

if (deps.size > 0) {
	console.log(`\npeer/runtime packages this pulled in — add any that are missing:`);
	for (const d of [...deps].sort()) console.log(`  bun add ${d}`);
}
console.log(`\ndone: ${seen.size} component(s)`);

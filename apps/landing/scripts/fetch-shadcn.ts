/**
 * Fetches shadcn-svelte components straight from the public registry, and writes
 * them into this app's own `src/lib/components/ui/`.
 *
 * Why not `bunx shadcn-svelte add`? The CLI hangs in this environment (verified
 * 2026-10-03: it never prints, it never writes). The registry is the same source
 * the CLI reads, so fetching it directly is deterministic, reviewable, and keeps
 * the Bun-only rule. This is the same technique as
 * `apps/app/scripts/fetch-shadcn.ts`, with one difference: every `$lib/...`
 * specifier is rewritten to a path relative to the file that imports it, so
 * what lands here matches the components already in `src/lib/components/ui/`.
 *
 *   bun scripts/fetch-shadcn.ts button badge card separator alert
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

const REGISTRY = 'https://shadcn-svelte.com/registry/styles/lyra';

/** This app's `src/lib`, i.e. what a `$lib` import means inside this app. */
const LIB = resolve(import.meta.dir, '../src/lib');

/** components.json aliases → where files actually land on disk, inside LIB. */
const ALIASES: Record<string, string> = {
	components: 'components',
	ui: 'components/ui',
	lib: '',
	hooks: 'hooks',
	utils: 'utils'
};

/**
 * The CLI rewrites these placeholders to the user's aliases before writing. The
 * raw registry JSON still carries them verbatim, and a literal `$UTILS$.js` in a
 * component is a broken import rather than a placeholder — so they are rewritten
 * here, to relative paths, in one pass.
 */
const PLACEHOLDERS: Record<string, string> = {
	$UTILS$: 'utils',
	$UI$: 'components/ui',
	$COMPONENTS$: 'components',
	$HOOKS$: 'hooks',
	$LIB$: ''
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

/** A POSIX-style relative specifier, always explicit enough to be unambiguous. */
function specifier(fromDir: string, abs: string): string {
	const rel = relative(fromDir, abs).split(sep).join('/');
	return rel.startsWith('.') ? rel : `./${rel}`;
}

function substitute(content: string, fromDir: string): string {
	const local = (sub: string) => specifier(fromDir, join(LIB, sub));

	let out = content;
	for (const [token, sub] of Object.entries(PLACEHOLDERS)) out = out.split(token).join(local(sub));

	// Items that predate the placeholder tokens carry `$lib/...` verbatim.
	return out.replace(/(["'])(\$lib\/[^"']+)\1/g, (_match, quote: string, spec: string) => {
		return `${quote}${local(spec.slice('$lib/'.length))}${quote}`;
	});
}

/** Current registry items ship `target` relative to the `ui` alias. */
function resolvePath(file: RegistryFile): string {
	if (file.target) return join(LIB, ALIASES.ui, file.target);
	if (!file.path) throw new Error(`${file.type ?? 'file'} entry has neither path nor target`);
	const [scope, ...rest] = file.path.split('/');
	const base = ALIASES[scope];
	return base !== undefined ? join(LIB, base, ...rest) : join(LIB, file.path);
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
		const body = substitute(file.content, dirname(target));
		await writeFile(target, body.endsWith('\n') ? body : `${body}\n`, 'utf8');
		console.log(`  ✓ ${target.replace(`${LIB}/`, 'src/lib/')}`);
	}

	for (const [key, value] of Object.entries(item.cssVars?.theme ?? {})) {
		console.log(`  ! css var ${key} = ${value} — confirm it is already in src/routes/layout.css`);
	}
}

if (deps.size > 0) {
	console.log('\npeer/runtime packages this pulled in — add any that are missing:');
	for (const d of [...deps].sort()) console.log(`  bun add ${d}`);
}
console.log(`\ndone: ${seen.size} component(s)`);

/**
 * Renders the web icon set from `lib/mark.ts`. Usage: `bun scripts/make-icons.ts`.
 * Dev-only: `@resvg/resvg-js` is a devDependency and never ships.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { markSvg, SHELL } from './lib/mark';

const ROOT = resolve(import.meta.dir, '..');
const OUT = join(ROOT, 'static/icons');

interface Target {
	file: string;
	size: number;
	/** Maskable icons clear the launcher's 80% safe zone behind a full plate. */
	maskable?: boolean;
}

const TARGETS: Target[] = [
	// The master. M6 hands this to `tauri icon`.
	{ file: 'icon-1024.png', size: 1024 },
	{ file: 'icon-512.png', size: 512 },
	{ file: 'icon-192.png', size: 192 },
	{ file: 'icon-maskable-512.png', size: 512, maskable: true },
	{ file: 'icon-maskable-192.png', size: 192, maskable: true }
];

await mkdir(OUT, { recursive: true });

for (const target of TARGETS) {
	const svg = markSvg({
		// ~13% of the canvas on each side, clearing the 80% safe zone.
		inset: target.maskable ? 134 : 0,
		background: target.maskable ? SHELL : null
	});

	// Every icon carries its own dark plate — launchers may be light or dark.
	const png = new Resvg(svg, { fitTo: { mode: 'width', value: target.size }, background: SHELL })
		.render()
		.asPng();

	const path = join(OUT, target.file);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, png);
	console.log(
		`  ✓ static/icons/${target.file}  ${target.size}×${target.size}  ${(png.length / 1024).toFixed(1)} kB`
	);
}

console.log(`\ndone — ${TARGETS.length} icons in static/icons/`);

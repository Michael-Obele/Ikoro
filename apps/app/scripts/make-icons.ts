/**
 * Renders the Ikoro icon set from the shared mark geometry.
 *
 * Why a script and not a checked-in binary: the mark is a handful of rectangles
 * and a circle, so the "source" is more legible as code than as a PNG nobody can
 * diff. Editing `lib/mark.ts` and re-running is a complete design workflow, and
 * every size comes out of the same geometry rather than from four hand-drawn
 * near-copies that slowly diverge.
 *
 *   bun scripts/make-icons.ts
 *
 * Dev-only: @resvg/resvg-js is a devDependency and is never bundled into the APK
 * or the desktop build.
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

	// The shell draws the icon on both light and dark launchers, so every icon
	// carries its own dark plate rather than relying on the platform to add one.
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

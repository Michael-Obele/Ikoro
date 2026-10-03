/**
 * Writes the Android launcher icon set from the SAME mark geometry the web icons
 * use (`lib/mark.ts`). Run after `make-icons.ts`, or on its own.
 *
 * Two icon systems, one source:
 *
 *   mipmap-*dpi/ic_launcher.png        legacy square/round tiles
 *   mipmap-anydpi-v26/ic_launcher.xml ADAPTIVE icon — a background plate plus a
 *                                      foreground layer the launcher masks to
 *                                      its own shape
 *
 * The adaptive FOREGROUND is drawn at 108dp, not 48: Android crops and shrinks a
 * foreground layer to its own safe zone, so a foreground that fills its canvas
 * has its edges clipped away. The artwork inside it is therefore inset by ~13%,
 * keeping it inside the 72dp safe zone of the 108dp layer.
 *
 *   bun scripts/make-android-icons.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { markSvg, SHELL } from './lib/mark';

const ROOT = resolve(import.meta.dir, '..');
const RES = join(ROOT, 'android/app/src/main/res');

/** Android launcher densities and the pixel size the legacy tile wants. */
const DENSITIES: Record<string, number> = {
	mdpi: 48,
	hdpi: 72,
	xhdpi: 96,
	xxhdpi: 144,
	xxxhdpi: 192
};

/** Adaptive foregrounds are authored at 108dp, per the platform's own guidance. */
const ADAPTIVE_DP = 108;
/** The inset that keeps the artwork inside that layer's 72dp safe zone. */
const SAFE_ZONE_INSET = 134;

const render = (svg: string, size: number) =>
	new Resvg(svg, { fitTo: { mode: 'width', value: Math.max(1, Math.round(size)) }, background: SHELL })
		.render()
		.asPng();

const fullBleed = markSvg({ background: SHELL });
const safeZone = markSvg({ inset: SAFE_ZONE_INSET, background: SHELL });

for (const [density, px] of Object.entries(DENSITIES)) {
	const dir = join(RES, `mipmap-${density}`);
	await mkdir(dir, { recursive: true });

	// Legacy tile: the mark at full bleed, at the density's own pixel size.
	const tile = render(fullBleed, px);
	await writeFile(join(dir, 'ic_launcher.png'), tile);
	await writeFile(join(dir, 'ic_launcher_round.png'), tile);

	// Adaptive foreground: a 108dp layer whose artwork sits inside the 72dp safe
	// zone, so however the launcher masks it, nothing is cut off.
	const foregroundPx = (px * ADAPTIVE_DP) / 48;
	await writeFile(join(dir, 'ic_launcher_foreground.png'), render(safeZone, foregroundPx));

	console.log(
		`  ✓ mipmap-${density}  ${px}px tile + ${Math.round(foregroundPx)}px foreground (${ADAPTIVE_DP}dp layer)`
	);
}

const anydpi = join(RES, 'mipmap-anydpi-v26');
await mkdir(anydpi, { recursive: true });

const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<!-- Adaptive icon: a solid plate plus a foreground layer the launcher masks to
     its own shape, so the mark is never clipped. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
await writeFile(join(anydpi, 'ic_launcher.xml'), adaptive);
await writeFile(join(anydpi, 'ic_launcher_round.xml'), adaptive);

const values = join(RES, 'values');
await mkdir(values, { recursive: true });
await writeFile(
	join(values, 'ic_launcher_background.xml'),
	`<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- The same near-black as the web icon's plate, so the launcher icon and
         the app chrome do not read as two different products. -->
    <color name="ic_launcher_background">${SHELL}</color>
</resources>
`
);

console.log('\ndone — Android launcher icons written');
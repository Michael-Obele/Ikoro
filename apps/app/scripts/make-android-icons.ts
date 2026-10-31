/**
 * Writes the Android launcher icon set from `lib/mark.ts`. Usage: `bun scripts/make-android-icons.ts`.
 * The adaptive foreground is drawn at 108dp with the art inset ~13% to clear the 72dp safe zone.
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

// `background` defaults to TRANSPARENT on purpose: an opaque foreground makes
// <monochrome> a featureless blob, so no themed icon can appear.
const render = (svg: string, size: number, background: string | null = null) =>
	new Resvg(svg, {
		fitTo: { mode: 'width', value: Math.max(1, Math.round(size)) },
		...(background ? { background } : {})
	})
		.render()
		.asPng();

// Legacy tiles keep the plate; it is baked into the SVG.
const fullBleed = markSvg({ background: SHELL });
// No plate: the adaptive `<background>` layer supplies it, and a plate here would hide it.
const safeZone = markSvg({ inset: SAFE_ZONE_INSET });
// Themed icons: one flat colour, hole punched out, so the launcher tints a real silhouette.
const silhouette = markSvg({ inset: SAFE_ZONE_INSET, monochrome: true });

for (const [density, px] of Object.entries(DENSITIES)) {
	const dir = join(RES, `mipmap-${density}`);
	await mkdir(dir, { recursive: true });

	// Legacy tile: the mark at full bleed, at the density's own pixel size.
	const tile = render(fullBleed, px);
	await writeFile(join(dir, 'ic_launcher.png'), tile);
	await writeFile(join(dir, 'ic_launcher_round.png'), tile);

	// 108dp layer, art inside the 72dp safe zone, so no launcher mask clips it.
	const foregroundPx = (px * ADAPTIVE_DP) / 48;
	await writeFile(join(dir, 'ic_launcher_foreground.png'), render(safeZone, foregroundPx));
	await writeFile(join(dir, 'ic_launcher_monochrome.png'), render(silhouette, foregroundPx));

	console.log(
		`  ✓ mipmap-${density}  ${px}px tile + ${Math.round(foregroundPx)}px foreground/monochrome (${ADAPTIVE_DP}dp layer)`
	);
}

const anydpi = join(RES, 'mipmap-anydpi-v26');
await mkdir(anydpi, { recursive: true });

const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<!-- Adaptive icon: a solid plate plus a foreground layer the launcher masks to
     its own shape, so the mark is never clipped.

     monochrome is a SEPARATE asset, not the foreground: Android 13+ themed
     icons keep only the layer's alpha and tint it with the wallpaper colour, so
     an opaque foreground renders as a solid square and no themed icon appears. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
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

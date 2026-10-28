/**
 * `ikoro-dynamic-colors` — the Android 12+ Material You palette reader.
 *
 * A LOCAL Capacitor plugin, not a published one. It exists because the app's
 * theme is a Material 3 role set (`--md-sys-color-*` in `routes/layout.css`) and
 * the one thing a WebView cannot do for itself is read the wallpaper palette the
 * OS already computed. Everything else — the tonal-to-role mapping, the oklch()
 * conversion, writing the CSS variables — stays in the web layer, where it is
 * testable without a device.
 *
 * The name is registered on BOTH sides and must match exactly:
 *   - here, in `registerPlugin<IDynamicColorsPlugin>('IkoroDynamicColors')`
 *   - in Kotlin, `@CapacitorPlugin(name = "IkoroDynamicColors")`
 * A mismatch is silent: the JS object exists, and every call rejects with
 * "not implemented" with nothing in logcat to explain it.
 */
import { registerPlugin } from '@capacitor/core';
import type {
	DynamicColorsAvailability,
	DynamicPalettesResult,
	IDynamicColorsPlugin
} from './definitions';

export * from './definitions';

/**
 * The plugin instance.
 *
 * On a non-Android shell this resolves to the web implementation in `web.ts`,
 * which answers `available: false`. That is why callers can call it
 * unconditionally and only branch on the RESULT — there is no platform check to
 * forget.
 */
export const IkoroDynamicColors = registerPlugin<IDynamicColorsPlugin>('IkoroDynamicColors', {
	web: () => import('./web').then((m) => new m.DynamicColorsWeb())
});

/**
 * Read the palettes, or `null` when this device cannot supply them.
 *
 * The helper exists so the theme store does not have to repeat the
 * "unavailable means null, and a rejection means null too" rule. A rejection is
 * treated as unavailable rather than propagated: the theme is decoration, and a
 * wallpaper read that fails must never take the app down with it.
 */
export async function readDynamicPalettes(): Promise<DynamicPalettesResult | null> {
	try {
		const result = await IkoroDynamicColors.getPalettes();
		return result.available ? result : null;
	} catch (error) {
		console.warn('[ikoro] dynamic colours unavailable', error);
		return null;
	}
}

/** Capability probe, with the same "a failure is a no" rule as above. */
export async function dynamicColorsAvailable(): Promise<DynamicColorsAvailability> {
	try {
		return await IkoroDynamicColors.isAvailable();
	} catch {
		return { available: false, sdkInt: 0 };
	}
}

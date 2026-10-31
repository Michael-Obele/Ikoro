/**
 * `ikoro-dynamic-colors` -- local Capacitor plugin that reads the Android 12+
 * Material You tonal palettes, the one thing a WebView cannot do itself. The plugin
 * name must match the Kotlin `@CapacitorPlugin` exactly; a mismatch only shows up as
 * a silent "not implemented".
 */
import { registerPlugin } from '@capacitor/core';
import type {
	DynamicColorsAvailability,
	DynamicPalettesResult,
	IDynamicColorsPlugin
} from './definitions';

export * from './definitions';

/**
 * The plugin instance. Off Android this resolves to `web.ts`, which answers
 * `available: false`, so callers can branch on the result instead of the platform.
 */
export const IkoroDynamicColors = registerPlugin<IDynamicColorsPlugin>('IkoroDynamicColors', {
	web: () => import('./web').then((m) => new m.DynamicColorsWeb())
});

/**
 * The palettes, or `null` when unavailable. A rejection is also `null` -- the
 * theme is decoration and must never take the app down.
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

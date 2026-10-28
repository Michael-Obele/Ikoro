/**
 * The wire contract for `ikoro-dynamic-colors`.
 *
 * This file is the source of truth for the shapes, and `android/src/main/java/
 * com/michaelobele/ikoro/dynamiccolors/IkoroDynamicColorsPlugin.kt` is the source
 * of truth for the values. They are transcribed from each other on purpose: the
 * Kotlin side cannot import TypeScript, so the only thing keeping them honest is
 * that both are short and both are read together.
 *
 * WHY PALETTES AND NOT A SCHEME. The native side could compute the M3 scheme
 * itself, but then the mapping would live in Kotlin, where it cannot be unit
 * tested without a device and cannot be reused by the web build. So the plugin
 * returns the RAW tonal palettes — the same five the system hands out — and the
 * mapping to roles happens in `apps/app/src/lib/theme/monet.ts`, in plain
 * TypeScript, under vitest.
 */

/** The five tonal palettes Android exposes, named as the system names them. */
export type PaletteName = 'accent1' | 'accent2' | 'accent3' | 'neutral1' | 'neutral2';

/**
 * One palette: tone -> `#rrggbb`.
 *
 * The tones are the M3 tone numbers (0, 10, 50, 100, 200, ... 1000), NOT array
 * indices, and they are keys rather than positions because a missing tone has to
 * be visible as a missing key instead of silently shifting every colour after it.
 * Android 12+ always supplies all twelve; the type allows a partial map so a
 * future API level that drops one degrades to a fallback rather than a crash.
 */
export type TonalPalette = Partial<Record<string, string>>;

/** What `getPalettes()` answers. */
export interface DynamicPalettesResult {
	/**
	 * False on every platform that is not Android 12+, and on Android below API
	 * 31. When false, `palettes` is `{}` — never a half-filled map, because a
	 * caller that checks the flag and a caller that does not must not disagree
	 * about whether there is anything to use.
	 */
	available: boolean;
	/** The device's API level, so the caller can explain WHY it is unavailable. */
	sdkInt: number;
	palettes: Partial<Record<PaletteName, TonalPalette>>;
}

/** What `isAvailable()` answers. */
export interface DynamicColorsAvailability {
	available: boolean;
	sdkInt: number;
}

export interface IDynamicColorsPlugin {
	/**
	 * Read the system's Material You tonal palettes.
	 *
	 * Resolves with `available: false` rather than rejecting when the platform
	 * cannot supply them. A rejection would make every caller write a try/catch
	 * around a condition that is normal on most devices, and "the wallpaper
	 * colours are not available" is not an error — it is an answer.
	 */
	getPalettes(): Promise<DynamicPalettesResult>;

	/** Cheap capability probe, for deciding whether to offer the option at all. */
	isAvailable(): Promise<DynamicColorsAvailability>;
}

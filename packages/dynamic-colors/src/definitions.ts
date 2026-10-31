/**
 * Wire contract for `ikoro-dynamic-colors`: the Kotlin plugin owns the values, this file
 * mirrors their shapes by hand because Kotlin cannot import TypeScript.
 */

/** The five tonal palettes Android exposes, named as the system names them. */
export type PaletteName = 'accent1' | 'accent2' | 'accent3' | 'neutral1' | 'neutral2';

/** One palette: M3 tone number -> `#rrggbb`. Tones are keys, not indices, so a gap is visible. */
export type TonalPalette = Partial<Record<string, string>>;

/** What `getPalettes()` answers. */
export interface DynamicPalettesResult {
	/** False off Android 12+; then `palettes` is `{}`, never half-filled. */
	available: boolean;
	/** The device's API level, so the caller can explain why it is unavailable. */
	sdkInt: number;
	palettes: Partial<Record<PaletteName, TonalPalette>>;
}

/** What `isAvailable()` answers. */
export interface DynamicColorsAvailability {
	available: boolean;
	sdkInt: number;
}

export interface IDynamicColorsPlugin {
	/** Resolves `available: false` rather than rejecting: unavailable is an answer, not an error. */
	getPalettes(): Promise<DynamicPalettesResult>;

	/** Cheap capability probe, for deciding whether to offer the option at all. */
	isAvailable(): Promise<DynamicColorsAvailability>;
}

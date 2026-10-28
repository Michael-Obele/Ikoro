/**
 * The web implementation.
 *
 * Dynamic colour is an Android SYSTEM capability: the palette is derived from the
 * wallpaper by the OS, and a browser has no wallpaper to read. So this answers
 * `available: false` and nothing else — it does not guess a palette from the
 * page, and it does not reject, because a caller on the web is not making a
 * mistake.
 *
 * `sdkInt: 0` rather than a made-up number: there is no Android API level here,
 * and 0 is the value that cannot be mistaken for a real one.
 */
import { WebPlugin } from '@capacitor/core';
import type {
	DynamicColorsAvailability,
	DynamicPalettesResult,
	IDynamicColorsPlugin
} from './definitions';

export class DynamicColorsWeb extends WebPlugin implements IDynamicColorsPlugin {
	async getPalettes(): Promise<DynamicPalettesResult> {
		return { available: false, sdkInt: 0, palettes: {} };
	}

	async isAvailable(): Promise<DynamicColorsAvailability> {
		return { available: false, sdkInt: 0 };
	}
}

/**
 * The web implementation. Palettes come from the OS wallpaper, which a browser has
 * none of, so this answers `available: false` and `sdkInt: 0` -- a value that cannot
 * be mistaken for a real API level.
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

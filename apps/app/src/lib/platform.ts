/**
 * Which shell this is running in. The order (Capacitor, then Tauri, then browser) is fixed:
 * the wrong pick means the reminder silently never fires.
 */
import { Capacitor } from '@capacitor/core';

export type Platform = 'android' | 'desktop' | 'browser';

export function detectPlatform(): Platform {
	if (typeof window === 'undefined') return 'browser';
	if (Capacitor.isNativePlatform()) return 'android';
	if ('__TAURI_INTERNALS__' in window || '__TAURI__' in window) return 'desktop';
	return 'browser';
}

export function isNative(): boolean {
	return detectPlatform() === 'android';
}

/**
 * Which shell is this running in.
 *
 * Checked in a fixed order — Capacitor, then Tauri, then plain browser — because
 * a Tauri window on a machine that also has a Capacitor WebView would otherwise
 * pick the wrong alarm implementation, and picking the wrong one means the
 * reminder silently never fires.
 *
 * Reading `window` is guarded rather than assumed: this module is imported by
 * code that also runs under SSR in tests and in the prerender pass, where
 * `window` does not exist.
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

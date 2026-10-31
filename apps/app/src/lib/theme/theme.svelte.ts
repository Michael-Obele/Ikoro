/** Theme store: System / Light / Dark — an explicit choice must beat the OS, which needs that third state.
 *  The storage key and resolution rule are also written in `app.html`'s inline pre-paint script; do not de-duplicate. */
import { PersistedState } from 'runed';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { readDynamicPalettes } from 'ikoro-dynamic-colors';
import { applyTokens, buildMonetSchemes, clearTokens, type TokenMap } from './monet';
import {
	getSeedSchemes,
	isSchemeId,
	type SchemeId,
	type SeedSchemeId
} from './schemes';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = Exclude<ThemeChoice, 'system'>;

export const THEME_STORAGE_KEY = 'ikoro:theme';
export const SCHEME_STORAGE_KEY = 'ikoro:scheme';
export const DARK_CLASS = 'dark';
export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

/** The only accepted values. Anything else in storage is ignored, not trusted. */
export const THEME_CHOICES = ['system', 'light', 'dark'] as const satisfies readonly ThemeChoice[];

export function isThemeChoice(value: unknown): value is ThemeChoice {
	return typeof value === 'string' && (THEME_CHOICES as readonly string[]).includes(value);
}

/** runed rather than hand-rolled: reads storage synchronously and syncs across tabs. */
export const themeChoice = new PersistedState<ThemeChoice>(THEME_STORAGE_KEY, 'system');

/** Defaults to crimson, the audited palette. A stored `dynamic` is kept even where it cannot be honoured. */
export const schemeChoice = new PersistedState<SchemeId>(SCHEME_STORAGE_KEY, 'crimson');

/** Starts false so the first render is deterministic; `watchSystemTheme()` fixes it before anyone sees it. */
let systemPrefersDark = $state(false);

/** A function, not an exported `$derived`: Svelte 5 only rejects derived exports at build time. */
export function resolvedTheme(): ResolvedTheme {
	return themeChoice.current === 'system'
		? systemPrefersDark
			? 'dark'
			: 'light'
		: themeChoice.current;
}

/** DOM side effect on a node Svelte does not own. `colorScheme` keeps UA scrollbars and the caret dark too. */
export function applyTheme(): void {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	const dark = resolvedTheme() === 'dark';
	root.classList.toggle(DARK_CLASS, dark);
	root.style.colorScheme = dark ? 'dark' : 'light';
}

/** Returns its own teardown so it can be handed straight out of an `$effect`. */
export function watchSystemTheme(): () => void {
	if (typeof window === 'undefined') return () => {};
	const media = window.matchMedia(DARK_MEDIA_QUERY);
	const sync = (): void => {
		systemPrefersDark = media.matches;
		// `applyResolvedTheme`, not `applyTheme`: the wallpaper palette is per-theme, so an OS flip must swap it too.
		applyResolvedTheme();
	};
	sync();
	media.addEventListener('change', sync);
	return () => media.removeEventListener('change', sync);
}

/** The only mutation: store the choice, then apply it. */
export function setTheme(choice: ThemeChoice): void {
	themeChoice.current = choice;
	if (typeof window !== 'undefined') {
		systemPrefersDark = window.matchMedia(DARK_MEDIA_QUERY).matches;
	}
	applyResolvedTheme();
}

/* ------------------------------------------------------------------ *
 * Colour scheme (seed themes)
 * ------------------------------------------------------------------ */

/** `dynamic` only once a palette has arrived; otherwise crimson, so the fallback is never a leftover. A function, not `$derived`, for the build reason above. */
export function resolvedScheme(): SeedSchemeId | 'dynamic' {
	const stored = schemeChoice.current;
	if (stored === 'dynamic') return dynamicSchemes ? 'dynamic' : 'crimson';
	return stored;
}

/** The only scheme mutation: write storage and re-apply in one step. */
export function setScheme(id: SchemeId): void {
	if (!isSchemeId(id)) return;
	schemeChoice.current = id;
	applyResolvedTheme();
}

/* ------------------------------------------------------------------ *
 * Dynamic colour (Material You)
 * ------------------------------------------------------------------ */

/** A rune so `applyResolvedTheme()` re-runs when the async read lands; the static scheme paints first. */
let dynamicSchemes = $state<{ light: TokenMap; dark: TokenMap } | null>(null);

/** What is currently written onto `<html>`, so a re-read can remove the old set. */
let appliedTokens: TokenMap | null = null;

/** Cached: an API level cannot change, and `isAvailable()` is a bridge round trip. */
let dynamicAvailable: boolean | null = null;

/** On mount and on every resume — the wallpaper can change while backgrounded. Every failure path leaves the current scheme in place. */
export async function refreshDynamicScheme(): Promise<void> {
	if (typeof window === 'undefined') return;
	if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;

	try {
		const result = await readDynamicPalettes();
		if (!result) {
			dynamicAvailable = false;
			return;
		}
		dynamicAvailable = true;
		dynamicSchemes = buildMonetSchemes(result.palettes);
		// `applyResolvedTheme`, not `applyTheme`: the scheme in force decides whether the palette is used at all.
		applyResolvedTheme();
	} catch (error) {
		console.warn('[ikoro] dynamic colour read failed', error);
	}
}

export function isDynamicAvailable(): boolean {
	return dynamicAvailable === true;
}

/** Inline custom properties on `<html>` beat `:root`/`.dark`, so this overrides rather than competes. Clearing before writing is the only order that leaves exactly one palette in force. */
function applyScheme(): void {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;

	if (appliedTokens) {
		clearTokens(root, appliedTokens);
		appliedTokens = null;
	}

	const scheme = resolvedScheme();
	const seed: SeedSchemeId = scheme === 'dynamic' ? 'crimson' : scheme;
	const tokens =
		scheme === 'dynamic' && dynamicSchemes
			? resolvedTheme() === 'dark'
				? dynamicSchemes.dark
				: dynamicSchemes.light
			: resolvedTheme() === 'dark'
				? getSeedSchemes(seed).dark
				: getSeedSchemes(seed).light;

	applyTokens(root, tokens);
	appliedTokens = tokens;
}

/** Wire the dynamic-colour lifecycle. Called once from the layout; returns its own teardown. */
export function watchDynamicColors(): () => void {
	if (typeof window === 'undefined') return () => {};

	void refreshDynamicScheme();

	let handle: { remove: () => Promise<void> } | null = null;
	let disposed = false;

	void CapApp.addListener('appStateChange', ({ isActive }) => {
		if (isActive) void refreshDynamicScheme();
	}).then((h) => {
		// The listener can resolve after teardown (fast unmount, hot reload) — remove it then and there.
		if (disposed) void h.remove();
		else handle = h;
	});

	return () => {
		disposed = true;
		void handle?.remove();
	};
}

/** One function, not two effects: the scheme is per-theme, so two effects would race on the same custom properties. */
export function applyResolvedTheme(): void {
	applyTheme();
	applyScheme();
}

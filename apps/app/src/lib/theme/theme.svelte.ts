/**
 * The theme store: System / Light / Dark.
 *
 * Three states, not two, on purpose. "Dark" plus an auto-switch is the usual
 * two-state design and it has a failure mode: the user cannot express "always
 * light", so the app overrides them every time the OS flips at dusk. An explicit
 * choice has to win permanently, and that needs a state that means "I have not
 * chosen yet".
 *
 * THE ORDER OF OPERATIONS IS THE WHOLE PROBLEM.
 *
 * A theme switch that flashes white on every load is worse than no switch: it is
 * a full-screen strobe for anyone loading the app in a dark room. So the class has
 * to be on `<html>` before the first paint, which is before any module runs. That
 * work is done by an inline script in `src/app.html` — it has to be inline,
 * because an imported module arrives after the CSS has already painted.
 *
 * The consequence is that the storage key, the JSON shape and the resolution rule
 * are written down TWICE: once there, once here. That duplication is deliberate
 * and `tests/theme-store.test.ts` guards the two against drifting apart. Do not
 * "de-duplicate" it by moving the script into a module.
 */
import { PersistedState } from 'runed';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { readDynamicPalettes } from 'ikoro-dynamic-colors';
import { applyTokens, buildMonetSchemes, clearTokens, type TokenMap } from './monet';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = Exclude<ThemeChoice, 'system'>;

export const THEME_STORAGE_KEY = 'ikoro:theme';
export const DARK_CLASS = 'dark';
export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

/** The only accepted values. Anything else in storage is ignored, not trusted. */
export const THEME_CHOICES = ['system', 'light', 'dark'] as const satisfies readonly ThemeChoice[];

export function isThemeChoice(value: unknown): value is ThemeChoice {
	return typeof value === 'string' && (THEME_CHOICES as readonly string[]).includes(value);
}

/**
 * The persisted choice, defaulting to `system` so a first run follows the OS.
 *
 * runed rather than a hand-rolled `localStorage.getItem`: it reads storage
 * synchronously at construction (which is what makes the class land before the
 * app hydrates), stays reactive through `createSubscriber`, and syncs across
 * tabs for free. The repo rule is to use runed rather than roll our own.
 */
export const themeChoice = new PersistedState<ThemeChoice>(THEME_STORAGE_KEY, 'system');

/**
 * What the OS currently wants. Starts `false` so the very first render is
 * deterministic; `watchSystemTheme()` corrects it before the first paint that
 * anyone can see, because `applyTheme()` reads this synchronously in the same tick.
 */
let systemPrefersDark = $state(false);

/**
 * The single source of truth for what the user actually sees.
 *
 * A FUNCTION, not an exported `$derived`. Svelte 5 refuses to export derived
 * state from a module — a module-level `$derived` belongs to no component, so
 * `vite build` fails with `derived_invalid_export` while `vitest` and
 * `svelte-check` both stay green. Exporting the READ as a function is
 * equivalent for callers: calling it from a template or from a `$derived` still
 * subscribes to the runes it touches.
 */
export function resolvedTheme(): ResolvedTheme {
	return themeChoice.current === 'system'
		? systemPrefersDark
			? 'dark'
			: 'light'
		: themeChoice.current;
}

/**
 * Write the resolved theme onto `<html>`.
 *
 * A DOM side effect on a node Svelte does not own — the reason this lives in a
 * plain function rather than a `$derived`. `colorScheme` matters as much as the
 * class: without it the UA stylesheet keeps painting scrollbars, form controls
 * and the caret in light, which is its own small flash on a dark page.
 */
export function applyTheme(): void {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	const dark = resolvedTheme() === 'dark';
	root.classList.toggle(DARK_CLASS, dark);
	root.style.colorScheme = dark ? 'dark' : 'light';
}

/**
 * Track the OS preference. Returns its own teardown so it can be handed straight
 * back out of an `$effect`.
 */
export function watchSystemTheme(): () => void {
	if (typeof window === 'undefined') return () => {};
	const media = window.matchMedia(DARK_MEDIA_QUERY);
	const sync = (): void => {
		systemPrefersDark = media.matches;
		// `applyResolvedTheme`, not `applyTheme`: on Android the wallpaper palette
		// is per-theme, so an OS flip at dusk has to swap the dynamic custom
		// properties too. Calling the plain version here would leave the light
		// palette's inline tokens overriding the dark stylesheet.
		applyResolvedTheme();
	};
	sync();
	media.addEventListener('change', sync);
	return () => media.removeEventListener('change', sync);
}

/**
 * The only mutation. An explicit choice is written to storage and takes effect
 * immediately; choosing `system` hands control back to the OS from that moment.
 */
export function setTheme(choice: ThemeChoice): void {
	themeChoice.current = choice;
	if (typeof window !== 'undefined') {
		systemPrefersDark = window.matchMedia(DARK_MEDIA_QUERY).matches;
	}
	applyResolvedTheme();
}

/* ------------------------------------------------------------------ *
 * Dynamic colour (Material You)
 * ------------------------------------------------------------------ */

/**
 * The scheme computed from the phone's wallpaper, or `null` when there is none.
 *
 * A rune, so `applyTheme()` can re-run when it arrives: the palette is read
 * asynchronously (a bridge call), which means the first paint always uses the
 * static scheme and the dynamic one lands a frame or two later. That is the
 * correct order — the static scheme is contrast-checked and always present, so
 * the app is never unstyled while it waits.
 */
let dynamicSchemes = $state<{ light: TokenMap; dark: TokenMap } | null>(null);

/** What is currently written onto `<html>`, so a re-read can remove the old set. */
let appliedTokens: TokenMap | null = null;

/**
 * Whether the user's device can supply a wallpaper palette.
 *
 * Read once and cached: the answer cannot change while the app is running (it is
 * an API level), and `isAvailable()` is a bridge round trip.
 */
let dynamicAvailable: boolean | null = null;

/**
 * Read the wallpaper palette and compute both schemes.
 *
 * Called on mount and on every resume. The resume re-read is not optional: the
 * user can change their wallpaper while the app is backgrounded, and Android
 * recomputes the palette when they do. Without it the app keeps the colours of a
 * wallpaper that no longer exists until the next cold start.
 *
 * Every failure path leaves `dynamicSchemes` as it was. A wallpaper read that
 * fails must never blank the theme — the static scheme is still on screen and
 * still correct.
 */
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
		applyTheme();
	} catch (error) {
		console.warn('[ikoro] dynamic colour read failed', error);
	}
}

/** Whether the dynamic option should be offered at all. */
export function isDynamicAvailable(): boolean {
	return dynamicAvailable === true;
}

/**
 * Write the dynamic scheme for the resolved theme, or restore the static one.
 *
 * Inline custom properties on `<html>` beat the stylesheet's `:root` and `.dark`
 * blocks by specificity, so this is a genuine override rather than a second
 * palette competing with the first. Clearing them is the whole of "go back to
 * the static scheme" — nothing else has to be undone.
 */
function applyDynamicScheme(): void {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;

	if (appliedTokens) {
		clearTokens(root, appliedTokens);
		appliedTokens = null;
	}

	if (!dynamicSchemes) return;
	const tokens = resolvedTheme() === 'dark' ? dynamicSchemes.dark : dynamicSchemes.light;
	applyTokens(root, tokens);
	appliedTokens = tokens;
}

/**
 * Wire the dynamic-colour lifecycle. Called once from the layout; safe to call
 * again.
 *
 * Returns its own teardown so it can be handed straight back out of an
 * `$effect`, the same shape as `watchSystemTheme()`.
 */
export function watchDynamicColors(): () => void {
	if (typeof window === 'undefined') return () => {};

	void refreshDynamicScheme();

	let handle: { remove: () => Promise<void> } | null = null;
	let disposed = false;

	void CapApp.addListener('appStateChange', ({ isActive }) => {
		if (isActive) void refreshDynamicScheme();
	}).then((h) => {
		// The listener can resolve after the effect has already torn down (a fast
		// unmount, or a hot reload). Removing it then is the only way to avoid a
		// listener that outlives the component that asked for it.
		if (disposed) void h.remove();
		else handle = h;
	});

	return () => {
		disposed = true;
		void handle?.remove();
	};
}

/**
 * Keep the DOM in step with the resolved theme AND the dynamic scheme.
 *
 * One function rather than two effects, because the two are not independent: the
 * dynamic scheme is per-theme, so a light/dark flip has to re-apply it, and a
 * palette arriving has to apply the half that matches the current theme. Split
 * across two effects they would race on the same custom properties.
 */
export function applyResolvedTheme(): void {
	applyTheme();
	applyDynamicScheme();
}

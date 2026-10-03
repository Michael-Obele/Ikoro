/**
 * Sync settings, in the `meta` store rather than localStorage.
 *
 * M1 declared `meta` for app-level scalars precisely so this needs no second
 * persistence mechanism and no schema change. `syncEnabled`, `syncBaseUrl` and
 * `syncCursor` all live there, and the sync cursor can then be written in the
 * same place it is read.
 */
import * as repo from '$lib/db/repo';

export interface SyncSettings {
	enabled: boolean;
	/** Empty string when sync is off. Never null — one shape, no branch. */
	baseUrl: string;
}

const ENABLED_KEY = 'syncEnabled';
const BASE_URL_KEY = 'syncBaseUrl';

export async function getSyncSettings(): Promise<SyncSettings> {
	const [enabled, baseUrl] = await Promise.all([
		repo.getMeta<boolean>(ENABLED_KEY),
		repo.getMeta<string>(BASE_URL_KEY)
	]);
	return { enabled: enabled === true, baseUrl: baseUrl ?? '' };
}

export async function setSyncSettings(settings: SyncSettings): Promise<void> {
	await repo.setMeta(ENABLED_KEY, settings.enabled);
	await repo.setMeta(BASE_URL_KEY, settings.baseUrl);
}

/** Sync settings live in the `meta` store, not localStorage -- one persistence layer, no schema change. */
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

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECK_INTERVAL_MS, checkForUpdate, isNewer, RELEASES_API } from '#lib/update';

/** Guards the update check: numeric version compare, and a throttle stamped before the fetch so an offline device retries once per window. */

const STORAGE_KEY = 'ikoro:update-checked';

const release = (tag: string) =>
	({
		ok: true,
		json: async () => ({ tag_name: tag, html_url: `https://example.test/${tag}` })
	}) as Response;

beforeEach(() => {
	localStorage.clear();
	vi.restoreAllMocks();
});

describe('isNewer', () => {
	it('compares numerically per segment, not as strings', () => {
		expect(isNewer('0.3.10', '0.3.9')).toBe(true);
		expect(isNewer('0.10.0', '0.9.9')).toBe(true);
	});

	it('accepts a leading v, the form release-please tags with', () => {
		expect(isNewer('v0.4.0', '0.3.2')).toBe(true);
	});

	it('answers false for equal, older and unparseable versions', () => {
		expect(isNewer('0.3.2', '0.3.2')).toBe(false);
		expect(isNewer('v0.3.1', '0.3.2')).toBe(false);
		expect(isNewer('not-a-version', '0.1.0')).toBe(false);
	});
});

describe('checkForUpdate', () => {
	it('reports a newer release with its tag and page', async () => {
		const fetchImpl = vi.fn(async () => release('v0.4.0'));
		const info = await checkForUpdate('0.3.2', fetchImpl as unknown as typeof fetch);
		expect(info).toEqual({ tag: '0.4.0', url: 'https://example.test/v0.4.0' });
		expect(fetchImpl).toHaveBeenCalledWith(
			RELEASES_API,
			expect.objectContaining({ headers: expect.objectContaining({ accept: expect.any(String) }) })
		);
	});

	it('stays silent when the release is not newer, or the endpoint fails', async () => {
		expect(
			await checkForUpdate('0.4.0', vi.fn(async () => release('v0.4.0')) as unknown as typeof fetch)
		).toBeNull();
		expect(
			await checkForUpdate(
				'0.3.2',
				vi.fn(async () => ({ ok: false, status: 404 }) as Response) as unknown as typeof fetch
			)
		).toBeNull();
		expect(
			await checkForUpdate(
				'0.3.2',
				vi.fn(async () => {
					throw new Error('offline');
				}) as unknown as typeof fetch
			)
		).toBeNull();
	});

	it('checks once per window — the timestamp lands before the fetch', async () => {
		const fetchImpl = vi.fn(async () => release('v9.9.9'));
		const asFetch = fetchImpl as unknown as typeof fetch;

		expect(await checkForUpdate('0.3.2', asFetch)).not.toBeNull();
		expect(await checkForUpdate('0.3.2', asFetch)).toBeNull();
		expect(fetchImpl).toHaveBeenCalledTimes(1);

		localStorage.clear();
		const failing = vi.fn(async () => {
			throw new Error('offline');
		});
		expect(await checkForUpdate('0.3.2', failing as unknown as typeof fetch)).toBeNull();
		expect(await checkForUpdate('0.3.2', failing as unknown as typeof fetch)).toBeNull();
		expect(failing).toHaveBeenCalledTimes(1);

		localStorage.setItem(STORAGE_KEY, String(Date.now() - CHECK_INTERVAL_MS - 1));
		expect(await checkForUpdate('0.3.2', asFetch)).not.toBeNull();
	});
});

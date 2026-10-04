import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The native plugin is replaced wholesale: these tests are about how
 * `AndroidScheduler` TRANSLATES the plugin's answers into `ScheduleOutcome` and
 * `AlarmPermissionStatus`, and
 * that translation is where "a failure was reported as a success" would come
 * from. The plugin itself is Kotlin and is covered by the device gate (M4-S1),
 * not by a unit test.
 *
 * Runs in the default `node` environment — no DOM, no IndexedDB, so no
 * `@vitest-environment jsdom` docblock. The mock replaces `./plugin` before
 * `registerPlugin` (or `@capacitor/core`) is ever touched, so nothing native is
 * required to run these.
 *
 * The permission branch is asserted on the rejection MESSAGE, because the
 * message is the contract: 'permission' vs 'unsupported' turns on whether the
 * native text contains "exact alarm permission", and getting that wrong sends
 * the user to a settings screen that cannot help them.
 */
const plugin = {
	schedule: vi.fn(),
	cancel: vi.fn(),
	cancelAll: vi.fn(),
	getPending: vi.fn(),
	checkStatus: vi.fn(),
	requestNotifications: vi.fn(),
	openExactAlarmSettings: vi.fn(),
	requestFullScreenIntentPermission: vi.fn(),
	addListener: vi.fn()
};

vi.mock('#lib/alarms/plugin', () => ({ IkoroAlarm: plugin }));

const { AndroidScheduler } = await import('#lib/alarms/android-scheduler');
const { hashId } = await import('#lib/utils/id');

const FUTURE = new Date(Date.now() + 3_600_000).toISOString();
const PAST = new Date(Date.now() - 1_000).toISOString();

beforeEach(() => {
	vi.clearAllMocks();
	plugin.schedule.mockResolvedValue({ platformId: '1' });
	plugin.cancel.mockResolvedValue(undefined);
	plugin.getPending.mockResolvedValue({ pending: [] });
	plugin.checkStatus.mockResolvedValue({
		notifications: 'granted',
		exact: true,
		fullScreenIntent: true
	});
	plugin.requestNotifications.mockResolvedValue({ notifications: 'granted' });
	plugin.openExactAlarmSettings.mockResolvedValue(undefined);
	plugin.requestFullScreenIntentPermission.mockResolvedValue(undefined);
	plugin.addListener.mockResolvedValue({ remove: vi.fn() });
});

describe('schedule', () => {
	it('arms through the native plugin with the hash-derived id and reports exact', async () => {
		const outcome = await new AndroidScheduler().schedule({
			taskId: 'task-1',
			title: 'Call the dentist',
			at: FUTURE
		});

		expect(plugin.schedule).toHaveBeenCalledWith({
			id: hashId('task-1'),
			taskId: 'task-1',
			title: 'Call the dentist',
			at: FUTURE
		});
		expect(outcome).toEqual({ ok: true, platformId: String(hashId('task-1')), exact: true });
	});

	it('derives the same id every time, so re-arming never duplicates an alarm', async () => {
		const scheduler = new AndroidScheduler();
		await scheduler.schedule({ taskId: 'task-1', title: 'x', at: FUTURE });
		await scheduler.schedule({ taskId: 'task-1', title: 'x', at: FUTURE });

		const first = plugin.schedule.mock.calls[0][0];
		const second = plugin.schedule.mock.calls[1][0];
		expect(first.id).toBe(hashId('task-1'));
		expect(first.id).toBe(second.id);
	});

	it('maps a native "exact alarm permission" rejection to reason: permission', async () => {
		plugin.schedule.mockRejectedValue(
			new Error(
				'exact alarm permission is not granted; open the alarm settings to arm this reminder'
			)
		);

		const outcome = await new AndroidScheduler().schedule({ taskId: 't', title: 'x', at: FUTURE });

		expect(outcome).toEqual({ ok: false, reason: 'permission' });
	});

	it('still reports permission when the refusal is the second native phrasing', async () => {
		plugin.schedule.mockRejectedValue(
			new Error('could not arm the alarm: exact alarm permission was refused')
		);

		const outcome = await new AndroidScheduler().schedule({ taskId: 't', title: 'x', at: FUTURE });

		expect(outcome).toEqual({ ok: false, reason: 'permission' });
	});

	it('maps any other native throw to reason: unsupported, never to success', async () => {
		plugin.schedule.mockRejectedValue(new Error('something went sideways in AlarmManager'));

		const outcome = await new AndroidScheduler().schedule({ taskId: 't', title: 'x', at: FUTURE });

		expect(outcome).toEqual({ ok: false, reason: 'unsupported' });
	});

	it('refuses an instant already in the past, without calling the native plugin', async () => {
		const outcome = await new AndroidScheduler().schedule({ taskId: 't', title: 'x', at: PAST });

		expect(outcome).toEqual({ ok: false, reason: 'invalid' });
		expect(plugin.schedule).not.toHaveBeenCalled();
	});

	it('refuses an unparseable instant, without calling the native plugin', async () => {
		const outcome = await new AndroidScheduler().schedule({
			taskId: 't',
			title: 'x',
			at: 'not-a-date'
		});

		expect(outcome).toEqual({ ok: false, reason: 'invalid' });
		expect(plugin.schedule).not.toHaveBeenCalled();
	});

	it('refuses an absent (empty) instant, without calling the native plugin', async () => {
		const outcome = await new AndroidScheduler().schedule({ taskId: 't', title: 'x', at: '' });

		expect(outcome).toEqual({ ok: false, reason: 'invalid' });
		expect(plugin.schedule).not.toHaveBeenCalled();
	});
});

describe('ensureReady', () => {
	it('reports the status the native plugin answers', async () => {
		expect(await new AndroidScheduler().ensureReady()).toEqual({
			notifications: 'granted',
			exact: 'granted',
			fullScreenIntent: 'granted'
		});
	});

	it('reports a granted full-screen intent', async () => {
		expect((await new AndroidScheduler().ensureReady()).fullScreenIntent).toBe('granted');
	});

	it('reports a REVOKED full-screen intent as denied, never as unsupported', async () => {
		// Android 14 lets the user revoke this, and the alarm then degrades to a
		// heads-up banner instead of taking over the screen. 'denied' is the honest
		// answer and the only one that makes the UI offer the Settings screen that
		// can fix it; 'unsupported' would wrongly imply there is nothing to fix,
		// which is exactly how the degradation stayed invisible before.
		plugin.checkStatus.mockResolvedValue({
			notifications: 'granted',
			exact: true,
			fullScreenIntent: false
		});

		expect((await new AndroidScheduler().ensureReady()).fullScreenIntent).toBe('denied');
	});

	it('keeps the exact and full-screen answers independent of each other', async () => {
		// They are two different permissions with two different fixes. Deriving one
		// from the other would silently drop whichever the user actually revoked.
		plugin.checkStatus.mockResolvedValue({
			notifications: 'granted',
			exact: false,
			fullScreenIntent: true
		});

		const status = await new AndroidScheduler().ensureReady();

		expect(status.exact).toBe('denied');
		expect(status.fullScreenIntent).toBe('granted');
	});

	it('does not prompt when notifications are already granted', async () => {
		await new AndroidScheduler().ensureReady();
		expect(plugin.requestNotifications).not.toHaveBeenCalled();
	});

	it('asks when the user has never been asked, and reports what came back', async () => {
		plugin.checkStatus.mockResolvedValue({
			notifications: 'prompt',
			exact: true,
			fullScreenIntent: true
		});
		plugin.requestNotifications.mockResolvedValue({ notifications: 'denied' });

		const status = await new AndroidScheduler().ensureReady();

		expect(plugin.requestNotifications).toHaveBeenCalled();
		expect(status.notifications).toBe('denied');
	});

	it('reports denied notifications rather than silently continuing', async () => {
		plugin.checkStatus.mockResolvedValue({
			notifications: 'denied',
			exact: true,
			fullScreenIntent: true
		});

		expect((await new AndroidScheduler().ensureReady()).notifications).toBe('denied');
	});

	it('maps a non-granted exact status to denied', async () => {
		plugin.checkStatus.mockResolvedValue({
			notifications: 'granted',
			exact: false,
			fullScreenIntent: false
		});

		expect((await new AndroidScheduler().ensureReady()).exact).toBe('denied');
	});

	it('never opens the system settings screen on its own', async () => {
		await new AndroidScheduler().ensureReady();
		expect(plugin.openExactAlarmSettings).not.toHaveBeenCalled();
	});
});

describe('cancel and pending', () => {
	it('forwards the platformId the store holds', async () => {
		await new AndroidScheduler().cancel(String(hashId('task-1')));
		expect(plugin.cancel).toHaveBeenCalledWith({ platformId: String(hashId('task-1')) });
	});

	it('survives a native cancel that throws', async () => {
		plugin.cancel.mockRejectedValue(new Error('no such alarm'));
		await expect(new AndroidScheduler().cancel('999')).resolves.toBeUndefined();
	});

	it('maps { pending: string[] } to a Set of platform ids', async () => {
		plugin.getPending.mockResolvedValue({ pending: ['42', '43'] });
		expect(await new AndroidScheduler().getPending()).toEqual(new Set(['42', '43']));
	});

	it('treats an unreadable pending list as empty rather than crashing a resume', async () => {
		plugin.getPending.mockRejectedValue(new Error('boom'));
		expect(await new AndroidScheduler().getPending()).toEqual(new Set());
	});
});

describe('full-screen intent settings', () => {
	it('hands off to the native full-screen intent screen', async () => {
		await new AndroidScheduler().openFullScreenIntentSettings();
		expect(plugin.requestFullScreenIntentPermission).toHaveBeenCalledTimes(1);
	});

	it('propagates a failed hand-off, leaving the decision to the caller', async () => {
		// Deliberately NOT swallowed here: the native method is the only thing that
		// knows why the screen would not open. The UI is the layer that has to keep
		// the banner up and carry on, and it catches exactly here.
		plugin.requestFullScreenIntentPermission.mockRejectedValue(new Error('no such activity'));
		await expect(new AndroidScheduler().openFullScreenIntentSettings()).rejects.toThrow(
			'no such activity'
		);
	});
});

describe('events', () => {
	it('yields the taskId when an alarm is dismissed', async () => {
		const seen: string[] = [];
		new AndroidScheduler().onAction((taskId) => seen.push(taskId));

		expect(plugin.addListener).toHaveBeenCalledWith('alarmDismissed', expect.any(Function));
		const listener = plugin.addListener.mock.calls[0][1];
		listener({ taskId: 'task-9' });
		listener({ taskId: '' });

		expect(seen).toEqual(['task-9']);
	});

	it('stamps a delivery when the alarm starts ringing', async () => {
		const seen: Array<[string, string]> = [];
		new AndroidScheduler().onDelivery((taskId, firedAt) => seen.push([taskId, firedAt]));

		expect(plugin.addListener).toHaveBeenCalledWith('alarmRinging', expect.any(Function));
		plugin.addListener.mock.calls[0][1]({ taskId: 'task-3' });

		expect(seen).toHaveLength(1);
		expect(seen[0][0]).toBe('task-3');
		expect(Number.isNaN(Date.parse(seen[0][1]))).toBe(false);
	});
});

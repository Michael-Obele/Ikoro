// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Capacitor plugin is replaced wholesale: these tests are about how
 * `AndroidScheduler` TRANSLATES the plugin's answers into `ScheduleOutcome`,
 * and that translation is where "a degraded alarm was reported as a success"
 * would come from. The plugin itself is Android's code and is covered by the
 * device gate (M4-S1), not by a unit test.
 *
 * `isExactMandatory: true` is asserted explicitly, because if it ever flips to
 * false the app would quietly start accepting inexact alarms and the product's
 * central promise would become a suggestion.
 */
const plugin = {
	schedule: vi.fn(),
	cancel: vi.fn(),
	getPending: vi.fn(),
	checkPermissions: vi.fn(),
	requestPermissions: vi.fn(),
	checkExactNotificationSetting: vi.fn(),
	changeExactNotificationSetting: vi.fn(),
	addListener: vi.fn()
};

vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: plugin }));

const { AndroidScheduler } = await import('#lib/alarms/android-scheduler');
const { hashId } = await import('#lib/utils/id');

const FUTURE = new Date(Date.now() + 3_600_000).toISOString();

beforeEach(() => {
	vi.clearAllMocks();
	plugin.schedule.mockResolvedValue({ notifications: [{ id: 1 }] });
	plugin.cancel.mockResolvedValue(undefined);
	plugin.getPending.mockResolvedValue({ notifications: [] });
	plugin.checkPermissions.mockResolvedValue({ display: 'granted' });
	plugin.requestPermissions.mockResolvedValue({ display: 'granted' });
	plugin.checkExactNotificationSetting.mockResolvedValue({ exact_alarm: 'granted' });
	plugin.addListener.mockResolvedValue({ remove: vi.fn() });
});

describe('schedule', () => {
	it('asks for an EXACT, while-idle alarm and marks exactness mandatory', async () => {
		await new AndroidScheduler().schedule({
			taskId: 'task-1',
			title: 'Call the dentist',
			at: FUTURE
		});

		const sent = plugin.schedule.mock.calls[0][0].notifications[0];
		// These live on the notification, NOT inside `schedule` — see the finding
		// at the top of android-scheduler.ts.
		expect(sent.isExactNotification).toBe(true);
		expect(sent.isExactMandatory).toBe(true);
		expect(sent.schedule.allowWhileIdle).toBe(true);
		expect(sent.schedule.isExactNotification).toBeUndefined();
	});

	it('uses a stable 32-bit id so re-arming never duplicates a notification', async () => {
		const scheduler = new AndroidScheduler();
		await scheduler.schedule({ taskId: 'task-1', title: 'x', at: FUTURE });
		await scheduler.schedule({ taskId: 'task-1', title: 'x', at: FUTURE });

		const first = plugin.schedule.mock.calls[0][0].notifications[0];
		const second = plugin.schedule.mock.calls[1][0].notifications[0];
		expect(first.id).toBe(second.id);
		expect(first.id).toBe(hashId('task-1'));
		expect(first.id).toBeGreaterThanOrEqual(0);
	});

	it('carries the taskId so tapping the notification opens that task', async () => {
		await new AndroidScheduler().schedule({ taskId: 'task-1', title: 'x', at: FUTURE });
		expect(plugin.schedule.mock.calls[0][0].notifications[0].extra).toEqual({ taskId: 'task-1' });
	});

	it('reports an exact schedule as exact', async () => {
		const outcome = await new AndroidScheduler().schedule({ taskId: 't', title: 'x', at: FUTURE });
		expect(outcome).toEqual({ ok: true, platformId: String(hashId('t')), exact: true });
	});

	it('reports a warning as DEGRADED, never as success', async () => {
		plugin.schedule.mockResolvedValue({
			notifications: [{ id: 1 }],
			warning: { code: 'OS-PLUG-LNOT-0001', message: 'Exact alarms not permitted' }
		});

		const outcome = await new AndroidScheduler().schedule({ taskId: 't', title: 'x', at: FUTURE });

		expect(outcome).toEqual({
			ok: true,
			platformId: String(hashId('t')),
			exact: false,
			warning: 'Exact alarms not permitted'
		});
	});

	it('maps a permission rejection to reason: permission', async () => {
		plugin.schedule.mockRejectedValue(new Error('Exact alarm permission denied by the user'));

		const outcome = await new AndroidScheduler().schedule({ taskId: 't', title: 'x', at: FUTURE });

		expect(outcome).toEqual({ ok: false, reason: 'permission' });
	});

	it('refuses an instant already in the past, without calling the plugin', async () => {
		const outcome = await new AndroidScheduler().schedule({
			taskId: 't',
			title: 'x',
			at: new Date(Date.now() - 1000).toISOString()
		});

		expect(outcome).toEqual({ ok: false, reason: 'invalid' });
		expect(plugin.schedule).not.toHaveBeenCalled();
	});

	it('refuses an unparseable instant', async () => {
		expect(
			await new AndroidScheduler().schedule({ taskId: 't', title: 'x', at: 'not-a-date' })
		).toEqual({
			ok: false,
			reason: 'invalid'
		});
	});
});

describe('ensureReady', () => {
	it('does not prompt when notifications are already granted', async () => {
		const status = await new AndroidScheduler().ensureReady();

		expect(status).toEqual({ notifications: 'granted', exact: 'granted' });
		expect(plugin.requestPermissions).not.toHaveBeenCalled();
	});

	it('requests permission when the user has never been asked', async () => {
		plugin.checkPermissions.mockResolvedValue({ display: 'prompt' });

		const status = await new AndroidScheduler().ensureReady();

		expect(plugin.requestPermissions).toHaveBeenCalled();
		expect(status.notifications).toBe('granted');
	});

	it('reports denied notifications rather than silently continuing', async () => {
		plugin.checkPermissions.mockResolvedValue({ display: 'denied' });

		expect((await new AndroidScheduler().ensureReady()).notifications).toBe('denied');
	});

	it('reports exact as denied when the alarm setting is off', async () => {
		plugin.checkExactNotificationSetting.mockResolvedValue({ exact_alarm: 'denied' });

		expect((await new AndroidScheduler().ensureReady()).exact).toBe('denied');
	});

	it('never opens the system settings screen on its own', async () => {
		await new AndroidScheduler().ensureReady();
		expect(plugin.changeExactNotificationSetting).not.toHaveBeenCalled();
	});
});

describe('cancel and pending', () => {
	it('cancels by numeric platform id', async () => {
		await new AndroidScheduler().cancel(String(hashId('task-1')));
		expect(plugin.cancel).toHaveBeenCalledWith({ notifications: [{ id: hashId('task-1') }] });
	});

	it('survives a platform that refuses to cancel', async () => {
		plugin.cancel.mockRejectedValue(new Error('no such notification'));
		await expect(new AndroidScheduler().cancel('999')).resolves.toBeUndefined();
	});

	it('reports pending ids as strings, because that is what the store stores', async () => {
		plugin.getPending.mockResolvedValue({ notifications: [{ id: 42 }, { id: 43 }] });

		expect(await new AndroidScheduler().getPending()).toEqual(new Set(['42', '43']));
	});

	it('treats an unreadable pending list as empty rather than crashing a resume', async () => {
		plugin.getPending.mockRejectedValue(new Error('boom'));
		expect(await new AndroidScheduler().getPending()).toEqual(new Set());
	});
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Tauri bridge is mocked wholesale. What is under test is how
 * `DesktopScheduler` REACTS to what the OS says it can do — and specifically,
 * that a degraded machine produces a visibly degraded outcome rather than a
 * success that quietly depends on the window staying open.
 */
const invoke = vi.fn();
const isPermissionGranted = vi.fn();
const requestPermission = vi.fn();
const sendNotification = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/plugin-notification', () => ({
	isPermissionGranted,
	requestPermission,
	sendNotification
}));

const { DesktopScheduler, resetDesktopProbe } = await import('$lib/alarms/desktop-scheduler');

const FUTURE = new Date(Date.now() + 3_600_000).toISOString();

const systemdProbe = {
	mode: 'systemd',
	systemd: true,
	notifySend: true,
	linger: true,
	detail: 'Alarms are scheduled by the system — they fire even when Ikoro is closed.',
	home: '/home/tester'
};

const timerProbe = {
	mode: 'timer',
	systemd: false,
	notifySend: true,
	linger: false,
	detail: 'Ikoro must be running to remind you.',
	home: '/home/tester'
};

/** Route `invoke` by command name, the way the real bridge does. */
function bridge(overrides: Record<string, unknown> = {}) {
	invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
		if (cmd in overrides) return overrides[cmd];
		switch (cmd) {
			case 'alarm_probe':
				return systemdProbe;
			case 'alarm_list':
				return ['123', '456'];
			case 'alarm_stamps':
				return [];
			default:
				return null;
		}
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	resetDesktopProbe();
	isPermissionGranted.mockResolvedValue(true);
	requestPermission.mockResolvedValue('granted');
	bridge();
});

describe('mode: systemd', () => {
	it('arms a real OS timer and reports it EXACT', async () => {
		const outcome = await new DesktopScheduler().schedule({ taskId: 't1', title: 'Call the dentist', at: FUTURE });

		expect(invoke).toHaveBeenCalledWith(
			'alarm_arm',
			expect.objectContaining({ hash: expect.stringMatching(/^\d+$/) })
		);
		expect(outcome).toEqual({ ok: true, platformId: `systemd:${String(outcome.ok && outcome.platformId.split(':')[1])}`, exact: true });
	});

	it('sends the ESCAPED unit content to Rust, never a raw title', async () => {
		await new DesktopScheduler().schedule({ taskId: 't1', title: '50% done "urgent"', at: FUTURE });

		const args = invoke.mock.calls.find((c) => c[0] === 'alarm_arm')?.[1] as Record<string, string>;
		expect(args.service).toContain('50%% done \\"urgent\\"');
		expect(args.service).not.toContain('50% done "urgent"');
	});

	it('passes an OnCalendar in local time, not UTC', async () => {
		const local = new Date(Date.now() + 7_200_000);
		await new DesktopScheduler().schedule({ taskId: 't1', title: 'x', at: local.toISOString() });

		const args = invoke.mock.calls.find((c) => c[0] === 'alarm_arm')?.[1] as Record<string, string>;
		const expected = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')} ${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
		expect(args.timer).toContain(`OnCalendar=${expected}`);
	});

	it('cancels through the OS, stripping the systemd: prefix', async () => {
		await new DesktopScheduler().cancel('systemd:999');

		expect(invoke).toHaveBeenCalledWith('alarm_cancel', { hash: '999' });
	});

	it('reports pending timers from systemd, namespaced', async () => {
		expect(await new DesktopScheduler().getPending()).toEqual(new Set(['systemd:123', 'systemd:456']));
	});

	it('NEVER falls back to an in-process timer when arming fails', async () => {
		bridge({ alarm_arm: Promise.reject(new Error('unit did not load')) });

		const outcome = await new DesktopScheduler().schedule({ taskId: 't1', title: 'x', at: FUTURE });

		// A silent fallback would leave the user believing they have an alarm that
		// dies with the window. Reporting failure is the only honest option.
		expect(outcome.ok).toBe(false);
		expect(sendNotification).not.toHaveBeenCalled();
	});
});

describe('mode: timer (fallback)', () => {
	beforeEach(() => {
		bridge({ alarm_probe: timerProbe });
	});

	it('reports the fallback as NOT exact, with a plain-language warning', async () => {
		const outcome = await new DesktopScheduler().schedule({ taskId: 't1', title: 'x', at: FUTURE });

		expect(outcome).toEqual({
			ok: true,
			platformId: expect.stringMatching(/^\d+$/),
			exact: false,
			warning: 'Ikoro must be running to remind you on this machine.'
		});
	});

	it('never writes a systemd unit', async () => {
		await new DesktopScheduler().schedule({ taskId: 't1', title: 'x', at: FUTURE });
		expect(invoke).not.toHaveBeenCalledWith('alarm_arm', expect.anything());
	});

	it('reflects in-process timers from getPending', async () => {
		const scheduler = new DesktopScheduler();
		await scheduler.schedule({ taskId: 't1', title: 'x', at: FUTURE });

		const pending = await scheduler.getPending();
		expect(pending.size).toBe(1);
		expect([...pending][0]).toMatch(/^\d+$/);
	});

	it('clears the local timer on cancel', async () => {
		const scheduler = new DesktopScheduler();
		const outcome = await scheduler.schedule({ taskId: 't1', title: 'x', at: FUTURE });
		if (!outcome.ok) throw new Error('setup failed');

		await scheduler.cancel(outcome.platformId);
		expect(await scheduler.getPending()).toEqual(new Set());
	});
});

describe('degraded probes', () => {
	it('falls back to timer when systemctl is unusable — without throwing', async () => {
		bridge({ alarm_probe: timerProbe });

		const probe = await new DesktopScheduler().currentMode();
		expect(probe.mode).toBe('timer');
		expect(probe.detail).toContain('running');
	});

	it('falls back to timer when the probe itself fails', async () => {
		bridge({ alarm_probe: Promise.reject(new Error('no IPC')) });

		const probe = await new DesktopScheduler().currentMode();

		// A crashing reconcile would leave every alarm silently un-armed. The safe
		// answer is a visible downgrade.
		expect(probe.mode).toBe('timer');
		expect(probe.detail).toMatch(/in-process/i);
	});

	it('reports linger=false so the UI can warn that alarms stop at logout', async () => {
		bridge({ alarm_probe: { ...systemdProbe, linger: false } });
		expect((await new DesktopScheduler().currentMode()).linger).toBe(false);
	});
});

describe('notification permission', () => {
	it('asks when permission has not been granted', async () => {
		isPermissionGranted.mockResolvedValue(false);
		requestPermission.mockResolvedValue('granted');

		expect(await new DesktopScheduler().ensureReady()).toEqual({
			notifications: 'granted',
			exact: 'unsupported'
		});
		expect(requestPermission).toHaveBeenCalled();
	});

	it('reports denied rather than pretending alarms will arrive', async () => {
		isPermissionGranted.mockResolvedValue(false);
		requestPermission.mockResolvedValue('denied');

		expect((await new DesktopScheduler().ensureReady()).notifications).toBe('denied');
	});
});

describe('missed detection', () => {
	it('exposes the fired stamps so a delivery can be told from a miss', async () => {
		bridge({ alarm_stamps: ['111', '222'] });
		expect(await new DesktopScheduler().firedStamps()).toEqual(new Set(['111', '222']));
	});

	it('reports no stamps when the state directory does not exist', async () => {
		bridge({ alarm_stamps: Promise.reject(new Error('ENOENT')) });
		expect(await new DesktopScheduler().firedStamps()).toEqual(new Set());
	});
});

describe('invalid input', () => {
	it('refuses an instant already in the past, in either mode', async () => {
		const past = new Date(Date.now() - 1000).toISOString();

		expect(await new DesktopScheduler().schedule({ taskId: 't', title: 'x', at: past })).toEqual({
			ok: false,
			reason: 'invalid'
		});
		expect(invoke).not.toHaveBeenCalledWith('alarm_arm', expect.anything());
	});
});
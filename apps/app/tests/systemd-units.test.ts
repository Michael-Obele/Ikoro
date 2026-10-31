import { describe, expect, it } from 'vitest';
import {
	ALARM_SOUND_ID,
	RING_SECONDS,
	buildServiceUnit,
	buildTimerUnit,
	escapeUnitArg,
	firedDir
} from '$lib/alarms/systemd';

/** Guards the generated systemd units: `%`, `"` and `\` in a user title otherwise yield a unit that silently never loads. */

describe('escapeUnitArg', () => {
	it('doubles a percent sign — otherwise systemd refuses to load the unit', () => {
		expect(escapeUnitArg('50% done')).toBe('50%% done');
	});

	it('escapes double quotes', () => {
		expect(escapeUnitArg('say "hi"')).toBe('say \\"hi\\"');
	});

	it('escapes backslashes', () => {
		expect(escapeUnitArg('a\\b')).toBe('a\\\\b');
	});

	it('strips newlines — a multi-line title breaks the unit file', () => {
		expect(escapeUnitArg('line1\nline2')).toBe('line1line2');
		expect(escapeUnitArg('line1\r\nline2')).toBe('line1line2');
	});

	it('leaves an ordinary title completely alone', () => {
		expect(escapeUnitArg('Call the dentist')).toBe('Call the dentist');
	});

	it('handles the pathological case: percent, quote and backslash together', () => {
		expect(escapeUnitArg('50% "urgent" \\ now')).toBe('50%% \\"urgent\\" \\\\ now');
	});

	it('is idempotent-safe: it never leaves a lone % behind', () => {
		expect(escapeUnitArg('%%%')).toBe('%%%%%%');
		expect(escapeUnitArg('100%%')).toBe('100%%%%');
	});
});

describe('buildTimerUnit', () => {
	const at = '2026-10-05 09:30:00';

	it('produces a timer that actually fires at the requested minute', () => {
		const unit = buildTimerUnit({ hash: 'abc123', at });

		expect(unit).toContain(`OnCalendar=${at}`);
		expect(unit).toContain('Unit=ikoro-abc123.service');
		expect(unit).toContain('Persistent=true');
		expect(unit).toContain('AccuracySec=1s');
	});

	it('declares Persistent — the boot catch-up, the Android BOOT_COMPLETED equivalent', () => {
		expect(buildTimerUnit({ hash: 'abc123', at })).toMatch(/^Persistent=true$/m);
	});

	it('requests a 1-second accuracy, because the whole product is about the minute', () => {
		expect(buildTimerUnit({ hash: 'abc123', at })).toMatch(/^AccuracySec=1s$/m);
	});

	it('is installed into timers.target so a restart re-arms it', () => {
		expect(buildTimerUnit({ hash: 'abc123', at })).toContain('WantedBy=timers.target');
	});
});

describe('buildServiceUnit', () => {
	it('has exactly three ExecStart lines: stamp, notify, ring', () => {
		const unit = buildServiceUnit({
			hash: 'abc123',
			title: 'Call the dentist',
			home: '/home/tester'
		});
		const execLines = unit.split('\n').filter((line) => line.startsWith('ExecStart='));

		// Order is the spec: the stamp must land before a 30 s ring can be cut short.
		expect(execLines).toHaveLength(3);
		expect(execLines[0]).toContain(firedDir('/home/tester'));
		expect(execLines[0]).toContain('abc123');
		expect(execLines[1]).toContain('notify-send');
		expect(execLines[2]).toContain('timeout');
	});

	it('rings, because a single chime is not an alarm', () => {
		const unit = buildServiceUnit({ hash: 'abc123', title: 'x', home: '/home/tester' });
		const ring = unit.split('\n').find((line) => line.includes('/usr/bin/timeout'));

		expect(ring).toBeDefined();
		expect(ring).toContain(`/usr/bin/timeout ${RING_SECONDS}`);
		expect(ring).toContain('while :; do');
		expect(ring).toContain(`--id=${ALARM_SOUND_ID}`);
		// A failing player must not become a busy loop for the whole window.
		expect(ring).toContain('|| sleep 1');
	});

	it('keeps the ring command free of the characters systemd mangles', () => {
		const unit = buildServiceUnit({ hash: 'abc123', title: 'x', home: '/home/tester' });
		const ring = unit.split('\n').find((line) => line.includes('/usr/bin/timeout')) ?? '';

		// `%` is a specifier and `"` stays literal inside a single-quoted arg.
		expect(ring).not.toContain('%');
		expect(ring).not.toContain('"');
	});

	it('treats the end of the ring as success, not as a failed unit', () => {
		const unit = buildServiceUnit({ hash: 'abc123', title: 'x', home: '/home/tester' });

		// 124 = `timeout` stopped the loop; SIGTERM = a cancel. Neither is a failure.
		expect(unit).toContain('SuccessExitStatus=124 143 SIGTERM SIGKILL');
	});

	it('asks the daemon for the alarm sound on the banner itself', () => {
		const unit = buildServiceUnit({ hash: 'abc123', title: 'x', home: '/home/tester' });

		expect(unit).toContain(`-h string:sound-name:${ALARM_SOUND_ID}`);
	});

	it('runs the whole thing as a oneshot, so systemd does not try to keep it alive', () => {
		expect(buildServiceUnit({ hash: 'abc123', title: 'x', home: '/home/tester' })).toContain(
			'Type=oneshot'
		);
	});

	it('asks for critical urgency, because a late reminder is a broken reminder', () => {
		expect(buildServiceUnit({ hash: 'abc123', title: 'x', home: '/home/tester' })).toContain(
			'--urgency=critical'
		);
	});

	it('escapes the title into the ExecStart argument', () => {
		const unit = buildServiceUnit({
			hash: 'abc123',
			title: '50% done "urgent"',
			home: '/home/tester'
		});
		expect(unit).toContain('50%% done \\"urgent\\"');
		expect(unit).not.toContain('"Ikoro" "50% done "urgent""');
	});

	it('does not let a title inject a second ExecStart', () => {
		const unit = buildServiceUnit({
			hash: 'abc123',
			title: 'x\nExecStart=/bin/rm -rf /\n#',
			home: '/home/tester'
		});
		const execLines = unit.split('\n').filter((line) => line.startsWith('ExecStart='));
		expect(execLines).toHaveLength(3);
	});

	it('escapes the home directory placeholder rather than expanding it', () => {
		expect(buildServiceUnit({ hash: 'abc123', title: 'x', home: '/home/tester' })).not.toContain(
			'%h'
		);
		expect(buildServiceUnit({ hash: 'abc123', title: 'x', home: '/home/tester' })).toContain(
			'/home/tester/.local/state/ikoro/fired'
		);
	});
});

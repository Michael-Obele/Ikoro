import { describe, expect, it } from 'vitest';
import { buildServiceUnit, buildTimerUnit, escapeUnitArg, firedDir } from '$lib/alarms/systemd';

/**
 * Pure string generation — no systemd, no Rust, no Tauri. This is the layer
 * where the product's desktop promise is either kept or quietly broken, and it
 * is testable anywhere.
 *
 * Systemd unit files are NOT shell. Three characters bite, and each one fails
 * silently in a way that is painful to debug on a machine that is not in front
 * of you:
 *
 *   %   systemd expands %h, %t, %n… and any OTHER %X is an error. The unit
 *       simply will not load. A task titled "50% done" breaks the timer.
 *   "   inside a quoted argument, must be escaped.
 *   \   must be escaped before the quote is.
 *
 * A task title is arbitrary user text. If it can contain a percent sign, the
 * alarm for it simply does not exist, and nothing says so.
 */

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
	it('has exactly two ExecStart lines: notify, then stamp', () => {
		const unit = buildServiceUnit({ hash: 'abc123', title: 'Call the dentist', home: '/home/tester' });
		const execLines = unit.split('\n').filter((line) => line.startsWith('ExecStart='));

		// Two, not one and not three. The second creates the state directory AND
		// drops the stamp in one shell line: systemd gives each ExecStart its own
		// shell, so a separate `mkdir` line would be a third directive and would
		// make the count of real commands misleading.
		expect(execLines).toHaveLength(2);
		expect(execLines[0]).toContain('notify-send');
		expect(execLines[1]).toContain(firedDir('/home/tester'));
		expect(execLines[1]).toContain('abc123');
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
		// The raw, unescaped form must NOT survive into the unit file.
		expect(unit).not.toContain('"Ikoro" "50% done "urgent""');
	});

	it('does not let a title inject a second ExecStart', () => {
		const unit = buildServiceUnit({
			hash: 'abc123',
			title: 'x\nExecStart=/bin/rm -rf /\n#',
			home: '/home/tester'
		});
		const execLines = unit.split('\n').filter((line) => line.startsWith('ExecStart='));
		expect(execLines).toHaveLength(2);
	});

	it('escapes the home directory placeholder rather than expanding it', () => {
		// %h is systemd's home specifier. The stamp path is written by JS, which
		// does not know the home directory, so it must be given an absolute one
		// rather than smuggling a specifier through the escaping.
		expect(buildServiceUnit({ hash: 'abc123', title: 'x', home: '/home/tester' })).not.toContain('%h');
		expect(buildServiceUnit({ hash: 'abc123', title: 'x', home: '/home/tester' })).toContain(
			'/home/tester/.local/state/ikoro/fired'
		);
	});
});
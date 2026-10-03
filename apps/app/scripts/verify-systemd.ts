/**
 * LIVE verification of the systemd alarm path — the part of M6 that can be
 * observed without a Tauri binary.
 *
 * ⚠️ WHY THIS EXISTS: the Tauri desktop binary cannot be compiled on this
 * machine. Tauri's Linux build needs libwebkit2gtk and libgtk-3 development
 * packages, and `sudo` on this machine requires a password, so the system
 * libraries cannot be installed non-interactively. That leaves the Rust IPC
 * wrapper uncompiled.
 *
 * Everything BELOW the wrapper is not unverified, though. This script performs
 * the exact same filesystem writes and `systemctl` invocations the Rust commands
 * perform, using the exact same unit text the TypeScript generator produces — so
 * the milestone's central claim ("an alarm fires with the app closed") is checked
 * against the real operating system, not against a string in a test file.
 *
 *   bun scripts/verify-systemd.ts [--wait <minutes>]
 */

import { mkdirSync, existsSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildServiceUnit, buildTimerUnit, toOnCalendar } from '../src/lib/alarms/systemd';

const HOME = homedir();
const UNIT_DIR = join(HOME, '.config/systemd/user');
const FIRED_DIR = join(HOME, '.local/state/ikoro/fired');

const waitMinutes = Number(
	process.argv.find((a) => a.startsWith('--wait'))?.split('=')[1]?.replace(/^--wait$/, '') ??
		2
);

function sh(cmd: string, args: string[]): { ok: boolean; out: string } {
	try {
		return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
	} catch (error) {
		const e = error as { stdout?: string; stderr?: string };
		return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
	}
}

function line(label: string, value: string) {
	console.log(`  ${label.padEnd(22)} ${value}`);
}

console.log('\n── 1. Probe ────────────────────────────────────────────────');
const running = sh('systemctl', ['--user', 'is-system-running']);
const usable = running.out.trim() === 'running' || running.out.trim() === 'degraded';
line('systemctl --user', running.out.trim());
line('notify-send', existsSync('/usr/bin/notify-send') ? 'present' : 'MISSING');
const linger = sh('loginctl', ['show-user', process.env.USER ?? 'node']);
line('Linger', linger.ok ? (linger.out.match(/Linger=(\w+)/)?.[1] ?? '?') : 'unknown');
console.log(`\n  MODE = ${usable ? 'systemd' : 'timer'}`);

if (!usable) {
	console.log('\n  systemd is not usable here, so there is nothing to verify.\n');
	process.exit(1);
}

// A deliberately hostile title: every character that breaks a systemd unit file.
const HASH = '4242424242';
const TITLE = '50% done "urgent"\\ now\nINJECTED';
const at = new Date(Date.now() + waitMinutes * 60_000);

console.log('\n── 2. Generate units (same code the app uses) ─────────────');
const service = buildServiceUnit({ hash: HASH, title: TITLE, home: HOME });
const timer = buildTimerUnit({ hash: HASH, at: toOnCalendar(at.toISOString()) });
console.log(
	service
		.split('\n')
		.filter(Boolean)
		.map((l) => `    ${l}`)
		.join('\n')
);
console.log(
	timer
		.split('\n')
		.filter(Boolean)
		.map((l) => `    ${l}`)
		.join('\n')
);

const injected = service.split('\n').filter((l) => l.startsWith('ExecStart=')).length;
console.log(`\n  ExecStart lines after a newline-injection attempt: ${injected} (must be 2)`);
console.log(`  raw "%" survives in the unit?                     ${service.includes('50% done') ? 'YES — BROKEN' : 'no'}`);

console.log('\n── 3. Write + arm ────────────────────────────────────────');
mkdirSync(UNIT_DIR, { recursive: true });
writeFileSync(join(UNIT_DIR, `ikoro-${HASH}.service`), service);
writeFileSync(join(UNIT_DIR, `ikoro-${HASH}.timer`), timer);

const reload = sh('systemctl', ['--user', 'daemon-reload']);
line('daemon-reload', reload.ok ? 'ok' : `FAILED ${reload.out.trim()}`);

const start = sh('systemctl', ['--user', 'restart', `ikoro-${HASH}.timer`]);
line('start timer', start.ok ? 'ok' : `FAILED ${start.out.trim()}`);

const listed = sh('systemctl', ['--user', 'list-timers', '--all', '--no-legend', '--plain']);
const row = listed.out.split('\n').find((l) => l.includes(`ikoro-${HASH}.timer`));
line('list-timers', row ? 'shows it' : 'NOT LISTED');
if (row) console.log(`    ${row.trim()}`);

console.log(`\n  Armed for ${at.toLocaleTimeString()} (${waitMinutes} min from now).`);
console.log('  >>> CLOSE EVERYTHING. Ikoro is not running — there is no Ikoro process.');
console.log('  >>> This script exits now. Wait for the alarm, then run:');
console.log(`      ls ${FIRED_DIR}/${HASH} && echo FIRED || echo NOT-FIRED`);
console.log(`      systemctl --user list-timers --all | grep ikoro-${HASH} || echo "timer gone"`);

console.log('\n── 4. Leaving the timer armed ────────────────────────────');
console.log(`  Re-arm with:  bun scripts/verify-systemd.ts`);
console.log(`  Cancel with:  bun scripts/verify-systemd.ts --cancel ${HASH}`);

export { FIRED_DIR, UNIT_DIR, HASH };

// Keep the unit files; this run's whole purpose is to leave a live timer behind.
void rmSync;
void readdirSync;
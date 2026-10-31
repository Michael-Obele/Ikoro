#!/usr/bin/env bun
/** Smoke-tests the app in an Android WebView over CDP (`adb forward` + connectOverCDP). Debug build only.
 *  Usage: `emulator -avd ikoro -no-window &`, `bun run dev`, then `bun scripts/android-smoke.ts`. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const ADB = process.env.ADB ?? `${process.env.ANDROID_HOME}/platform-tools/adb`;
const OUT = process.env.OUT ?? '/tmp/ikoro-android';

const run = (args: string[]) => execFileSync(ADB, args, { encoding: 'utf8' }).trim();

/** Expose the WebView's devtools socket on localhost:9222. */
function forwardWebViewSocket(): string {
	const sockets = run(['shell', 'cat', '/proc/net/unix'])
		.split('\n')
		.map((line) => (line.split(/\s+/).pop() ?? '').replace(/^@/, ''))
		.filter((path) => path.startsWith('webview_devtools_remote'));

	if (!sockets.length) {
		throw new Error('no WebView devtools socket — is the app running, and is this a debug build?');
	}

	run(['forward', 'tcp:9222', `localabstract:${sockets[0]}`]);
	return sockets[0];
}

/** Press the hardware Back key. */
function pressBack() {
	run(['shell', 'input', 'keyevent', '4']);
}

const results: { check: string; ok: boolean; note?: string }[] = [];
function check(name: string, ok: boolean, note?: string) {
	results.push({ check: name, ok, note });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
}

const socket = forwardWebViewSocket();
console.log(`CDP → ${socket}`);
// `noDefaults` is required: the WebView endpoint rejects Playwright's default
// context overrides ("context management is not supported").
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { noDefaults: true });
const context = browser.contexts()[0];
const page = context.pages()[0] ?? (await context.waitForEvent('page'));

await page.waitForTimeout(1500);
check('attached to the device WebView', await page.locator('main').count() > 0, await page.title());

// ── the reported bug: a reminder sheet that cannot be scrolled, closed, or backed out of ──

await page.getByRole('link', { name: 'Today' }).click();
await page.waitForTimeout(400);

const addRow = page.getByRole('button', { name: 'Add a task' });
await addRow.click();
const title = page.locator('main input').first();
// Unique per run — the device keeps IndexedDB between runs.
const taskName = `Android smoke ${Date.now()}`;
await title.fill(taskName);
await title.press('Enter');
await page.waitForTimeout(600);

await page.getByRole('button', { name: new RegExp(taskName) }).first().click();
await page.waitForTimeout(600);
check('task sheet opens', (await page.locator('[role="dialog"]').count()) === 1);

await page.getByRole('switch', { name: 'Remind me' }).click();
await page.waitForTimeout(1200);
check('reminder control does not throw the sheet away', (await page.locator('[role="dialog"]').count()) === 1);

// Reachable is what matters: it fits, or the body scrolls. Overflow that refuses
// to scroll is the broken case.
const reach = await page.evaluate(() => {
	const body = document.querySelector('[role="dialog"] .overflow-y-auto') as HTMLElement | null;
	const viewport = window.innerHeight;
	if (!body) return { found: false, fits: true, scrolled: false, lastBottom: 0, viewport };
	const last = body.lastElementChild?.getBoundingClientRect();
	body.scrollTop = 10_000;
	return {
		found: true,
		fits: body.scrollHeight <= body.clientHeight,
		scrolled: body.scrollTop > 0,
		lastBottom: Math.round(last?.bottom ?? 0),
		viewport
	};
});
check(
	'everything in the sheet is reachable',
	!reach.found || reach.fits || reach.scrolled || reach.lastBottom <= reach.viewport,
	JSON.stringify(reach)
);

await page.screenshot({ path: `${OUT}-sheet.png` });

pressBack();
await page.waitForTimeout(800);
const afterBack = await page.locator('[role="dialog"]').count();
check('hardware Back closes the sheet', afterBack === 0, `dialogs=${afterBack}`);

// Leaked history: a route popped underneath while the sheet stayed on top.
if (afterBack > 0) {
	await page.screenshot({ path: `${OUT}-back-failed.png` });
}

await browser.close();

const failed = results.filter((r) => !r.ok);
writeFileSync(`${OUT}-report.json`, JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed → ${OUT}-report.json`);
process.exit(failed.length === 0 ? 0 : 1);

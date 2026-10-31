#!/usr/bin/env bun
/**
 * Android smoke test — Playwright over the WebView's Chrome DevTools Protocol.
 *
 * WHY THIS SHAPE: a Capacitor app is a WebView, and an Android WebView is a
 * Chromium. So the "mobile Playwright" story is not a second framework — it is
 * `adb forward` plus `chromium.connectOverCDP`. No Appium, no driver server, no
 * page-object scaffolding.
 *
 *   emulator -avd ikoro -no-window &
 *   bun run dev                      # the app loads from 10.0.2.2:5173 (live reload)
 *   bun scripts/android-smoke.ts
 *
 * The app must be a DEBUG build: release builds disable WebView debugging and
 * the devtools socket never appears.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const ADB = process.env.ADB ?? `${process.env.ANDROID_HOME}/platform-tools/adb`;
const OUT = process.env.OUT ?? '/tmp/ikoro-android';

const run = (args: string[]) => execFileSync(ADB, args, { encoding: 'utf8' }).trim();

/** Find the WebView's devtools socket on the device and expose it on localhost:9222. */
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

/** Press the hardware Back key, which is what a user actually presses. */
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
// `noDefaults` is required, not cosmetic: an Android WebView's browser endpoint
// refuses the default context overrides Playwright applies (it dies on
// `Browser.setDownloadBehavior`: "context management is not supported").
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
// Unique per run: the device keeps its IndexedDB between runs, so a fixed name
// makes the second run ambiguous.
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

// The sheet is taller than some screens. What matters is that its last control
// can be reached — either the body scrolls, or the content fits and needs no
// scrolling. A body that OVERFLOWS but refuses to scroll is the broken case.
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

// Leaked history is the failure the Back key exposes: the user is now one
// screen back in the route stack and the sheet is still on top of it.
if (afterBack > 0) {
	await page.screenshot({ path: `${OUT}-back-failed.png` });
}

await browser.close();

const failed = results.filter((r) => !r.ok);
writeFileSync(`${OUT}-report.json`, JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed → ${OUT}-report.json`);
process.exit(failed.length === 0 ? 0 : 1);

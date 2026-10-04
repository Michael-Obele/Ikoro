/**
 * Drive the running app's WebView over the Chrome DevTools Protocol.
 *
 * Why not `adb shell input tap`: the permission dialog and the spike buttons
 * live at coordinates that differ per device and per dialog state, and a wrong
 * tap silently tests nothing. CDP evaluates real JavaScript in the real page, so
 * what is verified is what the app actually does — not a guess at where the
 * button was.
 *
 * Used only for the M4-S1 device gate. It drives the app; it does not reimplement
 * anything in it.
 *
 *   bun scripts/spike-drive.ts <command> [args...]
 */
import { readFileSync } from 'node:fs';

interface Target {
	type: string;
	title: string;
	url: string;
	webSocketDebuggerUrl: string;
}

async function targets(): Promise<Target[]> {
	const res = await fetch('http://localhost:9222/json/list');
	return (await res.json()) as Target[];
}

/** Evaluate an expression in the page and return its JSON value. */
export async function evaluate<T>(expression: string, awaitPromise = true): Promise<T> {
	const [target] = (await targets()).filter((t) => t.type === 'page');
	if (!target) throw new Error('no page target — is the app running?');

	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise<void>((resolve, reject) => {
		socket.onopen = () => resolve();
		socket.onerror = () => reject(new Error('devtools socket failed'));
	});

	const id = 1;
	const reply = new Promise<string>((resolve) => {
		socket.onmessage = (event) => {
			const message = JSON.parse(String(event.data)) as {
				id?: number;
				result?: { result?: { value?: unknown }; exceptionDetails?: { text?: string } };
			};
			if (message.id !== id) return;
			if (message.result?.exceptionDetails) {
				resolve(`__THREW__ ${message.result.exceptionDetails.text}`);
				return;
			}
			resolve(JSON.stringify(message.result?.result?.value ?? null));
		};
	});

	socket.send(
		JSON.stringify({
			id,
			method: 'Runtime.evaluate',
			params: {
				expression,
				awaitPromise,
				returnByValue: true,
				userGesture: true
			}
		})
	);

	const raw = await reply;
	socket.close();
	return raw as T;
}

const [, , command, ...args] = process.argv;

switch (command) {
	case 'goto': {
		await evaluate(`location.href = ${JSON.stringify(args[0])}; true`);
		// A SvelteKit client-side navigation is instant; the load event is what
		// matters, and the capacitor:// origin resolves locally either way.
		await new Promise((r) => setTimeout(r, 2500));
		console.log(await evaluate('({ url: location.href, title: document.title })'));
		break;
	}

	case 'dump': {
		// Everything the spike page renders — permissions, exact-alarm setting,
		// and any verbatim error — as plain text.
		const text = await evaluate<string>(
			'document.body.innerText.replace(/\\n{2,}/g, "\\n").trim()'
		);
		console.log(text);
		break;
	}

	case 'eval': {
		console.log(await evaluate(args.join(' ')));
		break;
	}

	case 'click': {
		// Click a button by its visible label, so a UI change breaks loudly
		// instead of tapping empty space.
		const label = args[0];
		const result = await evaluate<boolean>(
			`(() => {
				const btn = [...document.querySelectorAll('button')]
					.find((b) => b.textContent.trim().toLowerCase().includes(${JSON.stringify(label.toLowerCase())}));
				if (!btn) return false;
				btn.click();
				return true;
			})()`
		);
		console.log(result ? `clicked "${label}"` : `NO BUTTON MATCHING "${label}"`);
		break;
	}

	default:
		console.error('usage: spike-drive.ts goto <url> | dump | click <label> | eval <js>');
		process.exit(1);
}

void readFileSync;

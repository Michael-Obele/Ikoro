/**
 * The only place the app touches the download or the filesystem. `readJsonFile` throws a typed
 * error, because a raw `SyntaxError` tells the user nothing.
 */
import { Capacitor } from '@capacitor/core';

/** `ikoro-backup-2026-10-03.json` — sorts chronologically in a file picker. */
export function fileNameFor(date: Date = new Date()): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `ikoro-backup-${y}-${m}-${d}.json`;
}

/**
 * Offer `data` as a file. An Android WebView has no download manager and swallows the
 * `<a download>` click, so Android shares the file instead. Plugins load dynamically.
 */
export async function exportJson(filename: string, data: unknown): Promise<void> {
	const json = JSON.stringify(data, null, 2);

	if (Capacitor.getPlatform() === 'android') {
		const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
		const { Share } = await import('@capacitor/share');

		// Cache, not Documents: this is a hand-off copy, and Documents would leave a duplicate.
		const { uri } = await Filesystem.writeFile({
			path: filename,
			data: json,
			directory: Directory.Cache,
			encoding: Encoding.UTF8
		});

		await Share.share({ title: filename, url: uri, dialogTitle: 'Save your Ikoro backup' });
		return;
	}

	const blob = new Blob([json], { type: 'application/json' });
	const url = URL.createObjectURL(blob);

	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.rel = 'noopener';
	document.body.append(anchor);
	anchor.click();
	anchor.remove();

	// Revoked on the next tick: revoking synchronously cancels a download some browsers have not started.
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

export class FileReadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FileReadError';
	}
}

/** Read a `.json` file, or throw a message a person can act on. */
export async function readJsonFile(file: File): Promise<unknown> {
	const text = await file.text();
	try {
		return JSON.parse(text);
	} catch {
		throw new FileReadError(
			`“${file.name}” is not valid JSON. If you edited it in a text editor, check for a missing comma or brace.`
		);
	}
}

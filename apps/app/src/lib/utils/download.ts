/**
 * File in, file out — the only place the app touches the download or the
 * filesystem.
 *
 * `readJsonFile` throws a typed error rather than letting a `SyntaxError` reach
 * the UI: "Unexpected token } in JSON at position 412" tells a user nothing about
 * what to do next, and a stack trace rendered on screen is a bug regardless of
 * how small the file was.
 */

/** `ikoro-backup-2026-10-03.json` — sorts chronologically in a file picker. */
export function fileNameFor(date: Date = new Date()): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `ikoro-backup-${y}-${m}-${d}.json`;
}

/**
 * Offer `data` as a download.
 *
 * The object URL is revoked on the next tick — but only after the click has been
 * dispatched. Revoking synchronously is a classic race: some browsers have not
 * started the download yet, and the revocation cancels it.
 */
export function downloadJson(filename: string, data: unknown): void {
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);

	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.rel = 'noopener';
	document.body.append(anchor);
	anchor.click();
	anchor.remove();

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
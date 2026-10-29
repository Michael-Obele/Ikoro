/**
 * Everything this site claims, in one file.
 *
 * Not tidiness — a control. A marketing page is the one place where a claim
 * outlives the code it was written from, so the claims live here, next to a test
 * that fails when one of them quietly turns into something the build cannot do.
 * (`tests/content.test.ts` reads this file and the rendered markup.)
 *
 * Edit the copy here, not in the markup. If a row needs a caveat, the caveat is a
 * field on the row — a status is never implied by a heading.
 */

import type { ReleaseInfo } from './release';

export const site = {
	name: 'Ikoro',
	pronunciation: 'ih-KOR-oh',
	tagline: 'The gong that calls you.',
	repo: 'https://github.com/Michael-Obele/Ikoro',
	releases: 'https://github.com/Michael-Obele/Ikoro/releases',
	issues: 'https://github.com/Michael-Obele/Ikoro/issues'
} as const;

/** The one sentence the product exists to make true. */
export const promise = {
	headline: 'Set the time. Ikoro calls.',
	lead:
		'Ikoro is a task list where the reminder is the point. You give a task a time, ' +
		'Ikoro hands that time to the operating system, and the notification is the ' +
		"operating system's — not a timer running inside an app you have to leave open.",
	proof:
		'On Android that means the alarm is scheduled through the exact-alarm API. It ' +
		'arrives with Ikoro closed, with the screen off, and in Doze. If your phone will ' +
		'not grant exact alarms, Ikoro tells you that on the next launch instead of ' +
		'letting the reminder arrive quietly late.'
} as const;

export const nameStory = {
	term: 'ikoro',
	gloss:
		'Ịbani for the large slit-gong used to call assemblies and announce things. It ' +
		'is carried by the person who strikes it and sounded by hand, so it is heard ' +
		'when it is sounded — and not a moment before.',
	link: 'Sounded at the appointed time: that is the whole promise.'
} as const;

export interface View {
	name: string;
	what: string;
}

/** The screens, described the way somebody using them would describe them. */
export const views: View[] = [
	{
		name: 'Today',
		what:
			'Past and today, in that order. Anything dated before today sits at the top ' +
			'with the most overdue first, so what slipped is the first thing you see. ' +
			'The window stops at a year: a task from 2022 that was never done is a ' +
			'mistake, not an overdue item, and it does not get to bury today.'
	},
	{
		name: 'Upcoming',
		what:
			'The next seven days under one heading per day, starting tomorrow. Today has ' +
			'a screen of its own, so nothing you tick off appears to survive in the next ' +
			'tab.'
	},
	{
		name: 'Lists',
		what: 'Your own lists, in the order you put them. Rename, reorder, delete.'
	}
];

/** What a task is, stated as fields rather than as marketing. */
export const taskShape = [
	'A title, up to 1024 characters',
	'An optional note, up to 8192',
	'A date',
	'A time — which is the part Google Tasks throws away',
	'One of four priorities, or none'
] as const;

export interface Platform {
	id: string;
	name: string;
	/**
	 * `released` — there is a file to download.
	 * `unreleased` — it is built, and there is no download yet.
	 * `building` — planned, not built.
	 * `preview` — runs, with a stated limit on what it can do.
	 * `unsupported` — will not work in this version, and saying so is the point.
	 */
	status: 'released' | 'unreleased' | 'building' | 'preview' | 'unsupported';
	detail: string;
	/** Where the row's action goes. Absent when there is nothing to click. */
	href?: string;
	action?: string;
}

/**
 * Shown on the home page and on /download. States what is published and where
 * it lives. The buttons point at real files; nothing here is a download until it is.
 * The size and date clauses appear only when the release knows them (the live
 * path); the derived path omits them instead of inventing numbers.
 */
export function releaseNoticeFor(r: ReleaseInfo): string {
	const size = r.apkSizeBytes !== undefined ? ` (${formatBytes(r.apkSizeBytes)})` : '';
	const published =
		r.publishedAt !== undefined ? ` Published ${formatReleaseDate(r.publishedAt)}.` : '';
	return (
		`v${r.version} is published on GitHub Releases as an APK${size} and ` +
		'an AAB. There is no Play Store listing, so you sideload it.' +
		`${published} Alarms are verified on a physical device with the app closed.`
	);
}

/**
 * Shown on /changelog when the live release is newer than the newest curated
 * entry. States the lag instead of pretending the entry covers the release.
 */
export function lagNotice(version: string): string {
	return `v${version} is out — the notes below lag until the changelog entry is curated.`;
}

/** Bytes to megabytes with one decimal, e.g. `3.4 MB`. */
export function formatBytes(n: number): string {
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * An ISO timestamp to an en-GB date, e.g. `28 Oct 2026`. The locale and the
 * options are pinned so the output is deterministic regardless of host locale
 * (tests run in node, prerender runs on Netlify).
 */
export function formatReleaseDate(iso: string): string {
	return new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	}).format(new Date(iso));
}

/**
 * Numeric semver-triple compare: is `a` strictly newer than `b`?
 * Lexicographic compare would call 0.3.10 older than 0.3.9; this does not.
 */
export function isNewer(a: string, b: string): boolean {
	const pa = a.split('.').map(Number);
	const pb = b.split('.').map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const x = pa[i] ?? 0;
		const y = pb[i] ?? 0;
		if (x !== y) return x > y;
	}
	return false;
}

/**
 * The Android row without its version facts: the detail is standing copy
 * (what the platform does does not change per release), while the href and
 * action are filled in by `platformRows` from the release.
 */
const androidBase: Omit<Platform, 'href' | 'action'> = {
	id: 'android',
	name: 'Android 8 and later',
	status: 'released',
	detail:
		'Sideload the APK. The alarm is scheduled through Android itself with ' +
		'setAlarmClock, so it arrives with Ikoro closed. Verified on a physical Pixel ' +
		'with the app force-stopped. Not on the Play Store in this version — sideloading ' +
		'is how you install it. The release also carries an AAB.'
};

/**
 * The platform rows that never change: every row except Android, whose href
 * and action are filled in by `platformRows` from the release (the version
 * moves every release, so it cannot be a literal here).
 */
export const platforms: Platform[] = [
	{
		id: 'linux-desktop',
		name: 'Linux desktop',
		status: 'unreleased',
		detail:
			'The desktop build is the same interface with its own window. On Linux, ' +
			'reminders fire with the app closed through systemd user timers. Linux bundles ' +
			'(.deb/.AppImage) ship from the next release onward — there is no file to ' +
			'download yet.'
	},
	{
		id: 'windows-macos',
		name: 'Windows and macOS',
		status: 'unsupported',
		detail:
			'Ikoro runs, and reminders fire while it is running. Reminders that arrive ' +
			'with the app closed are not supported on Windows and macOS in this version: the ' +
			'desktop shell this project uses cannot schedule a notification — it shows one ' +
			'immediately. Linux is the exception, in the row above.'
	},
	{
		id: 'browser',
		name: 'In a browser',
		status: 'preview',
		detail:
			'The web build is for looking at the app. A reminder set in it fires only ' +
			'while the tab is open, and the app says so where you set it.'
	}
];

/**
 * The honest platform table. The Android row's href and action come from the
 * release, so a new version never needs a hand edit here. Nothing here
 * promises a capability M8 did not observe.
 */
export function platformRows(r: ReleaseInfo): Platform[] {
	return [{ ...androidBase, href: r.tagUrl, action: `v${r.version} release` }, ...platforms];
}

/** The same table as the short version, for the home page. */
export const limits: string[] = [
	'Linux reminders fire with the app closed, through systemd timers.',
	'Windows and macOS reminders only fire while Ikoro is running.',
	'The browser build only reminds you while the tab is open.',
	'No repeating tasks in this version. Subtasks ship one level deep.',
	'No Play Store listing. Sideload the APK.',
	'No sync yet. There is no server the app talks to.'
];

export interface PrivacyPoint {
	claim: string;
	detail: string;
}

export const privacy: PrivacyPoint[] = [
	{
		claim: 'No account.',
		detail:
			'Nothing to sign up for, no email address, no password. There is no login ' +
			'screen because there is no user.'
	},
	{
		claim: 'Your tasks stay on the device.',
		detail:
			'They are stored in IndexedDB, the browser database inside the app, and the ' +
			'app reads and writes them there.'
	},
	{
		claim: 'Nothing is collected.',
		detail:
			'No telemetry, no analytics, no crash reporting, no identifiers, no ' +
			'third-party calls. There is nothing to consent to, which is why this site ' +
			'has no cookie banner and this app has no account.'
	},
	{
		claim: 'Your data is a file you can read.',
		detail:
			'Export writes every list and task to a JSON file. Import reads one back. ' +
			'Import merges by id and keeps the newer edit, so restoring an old backup ' +
			'cannot roll back something you changed since.'
	},
	{
		claim: 'Sync is optional, and it is not here yet.',
		detail:
			'The plan is a sync server you run yourself. It is not part of this version, ' +
			'so the app makes no network requests at all.'
	}
];

/** What the site itself does, for /privacy. */
export const sitePrivacy: PrivacyPoint[] = [
	{
		claim: 'This site has no trackers.',
		detail:
			'No analytics, no advertising tags, no fonts from a font CDN, no embedded ' +
			'third-party iframes, no cookies. The pages are static HTML, CSS and ' +
			'Svelte, served as files.'
	},
	{
		claim: 'The only thing stored is your theme choice.',
		detail:
			'Your light, dark or system theme choice is kept in local storage in this ' +
			'browser, so the site opens in the theme you picked. Nothing else is ' +
			'stored: no cookies, no trackers, no analytics.'
	},
	{
		claim: 'The host keeps ordinary server logs.',
		detail:
			'Whoever serves these files keeps the logs their host normally keeps, the ' +
			'same as any website. This project does not read them and has no access to ' +
			'them.'
	}
];

export interface Release {
	version: string;
	date: string;
	summary: string;
	included: string[];
	notIncluded: string[];
}

export const releases: Release[] = [
	{
		version: '0.3.2',
		date: '2026-10-28',
		summary:
			'Lists and tasks, Android alarms verified on device, Linux desktop alarms that ' +
			'fire with the app closed, subtasks one level deep, and a theme picker with ' +
			'previews. Linux bundles ship from the next release onward.',
		included: [
			'Lists: create, rename, reorder, delete',
			'Tasks: title, note, date, time, priority, subtasks one level deep, per-task color',
			'Today, Upcoming, Lists and Done screens',
			'Android exact alarms with setAlarmClock, verified on device with the app closed',
			'Linux desktop alarms through systemd user timers, firing with the app closed',
			'A banner that appears when notification or exact-alarm permission is missing',
			'Reminders rescheduled when the app comes back to the foreground, re-armed on boot',
			'JSON export and import of every list and task, including color and parentId',
			'Theme picker with miniature previews'
		],
		notIncluded: [
			'No Play Store listing — sideload the APK',
			'No desktop download in this version — Linux .deb/.AppImage ship next',
			'No closed-app reminders on Windows and macOS; they fire while the app runs',
			'No sync, and no account',
			'No repeating tasks',
			'No iOS build'
		]
	}
];

/**
 * Internal links. A route that appears in the navigation must appear here, or the
 * nav test fails — which is the point of listing them.
 */
export const routes = ['/', '/download', '/privacy', '/changelog'] as const;

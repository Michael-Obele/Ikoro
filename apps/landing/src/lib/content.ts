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

import {
	ASSET_ORDER,
	isDownloadable,
	type AssetKind,
	type PlatformKey,
	type ReleaseInfo
} from './release';

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
 * What each published file is, in the words somebody downloading it needs.
 * `label` is what the button says; `note` is the line under it that decides
 * whether this is the file for them.
 */
export const assetLabels: Record<AssetKind, { label: string; note: string }> = {
	apk: { label: 'APK', note: 'Sideload on Android 8 or later.' },
	deb: { label: 'DEB', note: 'Debian, Ubuntu, Zorin, Mint.' },
	appImage: { label: 'AppImage', note: 'Any Linux. Make it executable, then run it.' },
	rpm: { label: 'RPM', note: 'Fedora, openSUSE. Built only when the runner can.' }
};

/**
 * The one thing the site is allowed to say about the current release.
 *
 * Three states, because there are three truths and they need different words:
 *
 * - `ready` — GitHub reported every file the pipeline publishes.
 * - `building` — the tag exists and some files have not landed yet. Two
 *   independent builds upload minutes apart, so this is normal, not broken.
 *   The page must SAY that, because the alternative is a download button that
 *   leads to a GitHub 404.
 * - `unconfirmed` — the build could not reach GitHub at all, so it knows the
 *   version number and nothing else. No file is promised.
 */
export interface ReleaseNotice {
	state: 'ready' | 'building' | 'unconfirmed';
	title: string;
	body: string;
}

/** "a", "a and b", "a, b and c" — one list, in the site's voice. */
function joinWords(items: string[]): string {
	if (items.length === 0) return '';
	if (items.length === 1) return items[0];
	return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Shown on the home page and on /download. The size and date clauses appear
 * only when the release knows them; nothing here names a file GitHub did not
 * report.
 */
export function releaseNotice(r: ReleaseInfo): ReleaseNotice {
	if (r.source === 'derived') {
		return {
			state: 'unconfirmed',
			title: `v${r.version} could not be checked`,
			body:
				'This page is generated from the repository and could not reach GitHub while it ' +
				'was built, so it cannot confirm which files exist. Open the release to see what ' +
				'is actually there — and if the tag is fresh, give the builds a few minutes.'
		};
	}

	const missing = ASSET_ORDER.filter((kind) => r.assets[kind] === undefined);

	if (missing.length > 0) {
		return {
			state: 'building',
			title: `v${r.version} is tagged — the builds are still landing`,
			body:
				'Tagging a release starts two builds: Android takes about three minutes and the ' +
				`Linux desktop bundles about six, so for a few minutes the release exists with ` +
				`only some of its files. Still to arrive: ${joinWords(
					missing.map((kind) => assetLabels[kind].label)
				)}. Everything this page offers is a real file — nothing here links to one that ` +
				'is not there yet.'
		};
	}

	// Only the files GitHub actually reported, with the size when it reported one.
	const files = ASSET_ORDER.flatMap((kind) => {
		const asset = r.assets[kind];
		if (asset === undefined) return [];
		const label = assetLabels[kind].label;
		return [asset.sizeBytes !== undefined ? `${label} (${formatBytes(asset.sizeBytes)})` : label];
	});
	const published = r.publishedAt !== undefined ? ` Published ${formatReleaseDate(r.publishedAt)}.` : '';

	return {
		state: 'ready',
		title: `v${r.version} is out`,
		body:
			`v${r.version} is on GitHub Releases as ${joinWords(files)}.${published} ` +
			'There is no Play Store listing, so Android is a sideload. Alarms are verified on a ' +
			'physical device with the app closed.'
	};
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
 * The Android row without its release facts. The detail is standing copy —
 * what the platform does does not change per release — while the status, href
 * and action are filled in by `platformRows` from the release itself.
 */
const androidBase: Omit<Platform, 'href' | 'action' | 'status'> = {
	id: 'android',
	name: 'Android 8 and later',
	detail:
		'Sideload the APK. The alarm is scheduled through Android itself with ' +
		'setAlarmClock, so it arrives with Ikoro closed. Verified on a physical Pixel ' +
		'with the app force-stopped. Not on the Play Store in this version — sideloading ' +
		'is how you install it.'
};

/**
 * The Linux desktop row, same shape and same rule: the release decides whether
 * it may claim a download.
 */
const linuxBase: Omit<Platform, 'href' | 'action' | 'status'> = {
	id: 'linux-desktop',
	name: 'Linux desktop',
	detail:
		'The same interface in its own window. Reminders fire with the app closed through ' +
		'systemd user timers, which is what makes Linux the one desktop build that keeps ' +
		'the promise. Ships as a .deb and an AppImage, plus an .rpm when the runner can ' +
		'build one.'
};

/**
 * The platform rows that never change: every row the release cannot affect.
 * Android and Linux are built by `platformRows`, because whether they have a
 * download is a fact about the release, not about the platform.
 */
export const platforms: Platform[] = [
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
 * A platform may claim `released` only when the release is live AND carries
 * every file that platform promises. A derived release is not live, so it
 * releases nothing — which is how the table stays silent about files the page
 * has not seen.
 */
function statusFor(r: ReleaseInfo, platform: PlatformKey): Platform['status'] {
	return isDownloadable(r, platform) ? 'released' : 'unreleased';
}

/**
 * The honest platform table. Status, href and action come from the release, so
 * a new version never needs a hand edit here and a half-uploaded release never
 * claims a download it cannot serve. Nothing here promises a capability M8 did
 * not observe.
 */
export function platformRows(r: ReleaseInfo): Platform[] {
	const href = r.tagUrl;
	const action = `v${r.version} release`;
	return [
		{ ...androidBase, status: statusFor(r, 'android'), href, action },
		{ ...linuxBase, status: statusFor(r, 'linux'), href, action },
		...platforms
	];
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

/**
 * How many versions /changelog prints. Ten is the whole tagged history today,
 * and it stays a ceiling rather than a promise: an entry is curated copy, so a
 * version with no entry cannot be invented into one.
 */
export const changelogLimit = 10;

/**
 * The curated history, newest first — `releases[0]` is what the lag notice on
 * /changelog compares the live release against, so this order is load-bearing.
 *
 * Every entry lists what is missing as well as what is in it. That is the rule
 * the page exists to keep: a changelog that only lists the good parts is
 * marketing. Each `included` line is drawn from the commits that version
 * shipped, and each `notIncluded` line is something a reader could reasonably
 * assume and would be wrong to.
 */
export const releases: Release[] = [
	{
		version: '0.3.4',
		date: '2026-10-29',
		summary:
			'A short release of fixes after the desktop bundles landed: the task sheet ' +
			'scrolls, and how long snooze lasts is yours to choose.',
		included: [
			'Task sheet: the generated width is overridden and the body scrolls, so a long task is fully reachable',
			'Snooze length is configurable — 2, 5, 10 or 15 minutes',
			'Landing deploy pins its base and Bun version, so a Netlify rebuild stops guessing',
			'Kotlin alarm sources formatted; the dynamic-colors Android build output is ignored'
		],
		notIncluded: [
			'No Play Store listing — sideload the APK',
			'No iOS build',
			'No repeating tasks — the schema reserves the field, and reserving is not shipping',
			'No closed-app reminders on Windows and macOS; they fire while the app runs'
		]
	},
	{
		version: '0.3.3',
		date: '2026-10-29',
		summary:
			'The first release with a Linux desktop download, alongside a per-task ringtone ' +
			'and a landing site that reads the live release instead of a hand-kept number.',
		included: [
			'Linux desktop bundles: .deb, .AppImage and, when the runner can build one, .rpm',
			'One tag now starts the Android and desktop builds side by side and attaches both to the same release',
			'Per-task ringtone',
			'Banners, and a dark-theme colour fix',
			'The landing site reads the live release from GitHub at build time'
		],
		notIncluded: [
			'No Windows or macOS bundle — Linux is the only desktop OS whose alarms survive a closed app',
			'The desktop bundles are unsigned; there is no desktop keystore and no signing step',
			'No Play Store listing — sideload the APK',
			'No repeating tasks'
		]
	},
	{
		version: '0.3.2',
		date: '2026-10-28',
		summary:
			'The release that handed the version number to release-please, and gave the theme ' +
			'picker miniature previews.',
		included: [
			'release-please owns the version: one release PR, one tag, no hand-edited number',
			'Theme picker redesigned with miniature previews',
			'Release assets renamed to Ikoro-v<version>, so a download says which release it came from',
			'Artifacts attached with gh instead of action-gh-release, which 403s on a release that already exists'
		],
		notIncluded: [
			'No desktop download in this release — the Linux pipeline lands in the next one',
			'No Play Store listing — sideload the APK',
			'No repeating tasks'
		]
	},
	{
		version: '0.3.1',
		date: '2026-10-28',
		summary:
			'A correctness pass: subtask rows render, the empty state renders, and the version ' +
			'policy gets teeth.',
		included: [
			'Subtask rows render through self-import recursion instead of vanishing',
			'EmptyState renders its icon through the capitalised local name',
			'One version tool, plus a guard that refuses a tag smaller than the commits claim',
			'Release assets carry the version in their name',
			'The commit-to-version policy is written down in RELEASE.md'
		],
		notIncluded: [
			'No desktop download in this version',
			'No Play Store listing — sideload the APK'
		]
	},
	{
		version: '0.3.0',
		date: '2026-10-28',
		summary: 'Subtasks, one level deep, and a backup that survives them.',
		included: [
			'Subtasks, one level deep',
			'Export and import round-trip task colour and parentId, so a restored backup keeps its shape'
		],
		notIncluded: [
			'No desktop download in this version',
			'No subtasks deeper than one level',
			'No Play Store listing — sideload the APK'
		]
	},
	{
		version: '0.2.1',
		date: '2026-10-28',
		summary: 'Six colour schemes, a picker for them, and a contrast test to keep them honest.',
		included: [
			'Six seed colour schemes',
			'A picker for them',
			'A contrast test, so a scheme that fails AAA fails the build instead of shipping',
			'A per-task colour bar and a priority label in the editor'
		],
		notIncluded: [
			'No subtasks yet',
			'No desktop download in this version',
			'No Play Store listing — sideload the APK'
		]
	},
	{
		version: '0.2.0',
		date: '2026-10-28',
		summary: 'The first tagged build: a task list whose alarm is the product.',
		included: [
			'Lists and tasks, with a date and a time of their own',
			'A real Android alarm scheduled through the system, not a timer inside an app you leave open',
			'Today, Upcoming and Lists screens, and a phone bottom navigation',
			'Material 3 colour roles behind an AAA contrast gate, plus a dark theme',
			'JSON backup export and import',
			'A Linux desktop shell, with alarms through systemd user timers',
			'Their own icons, an alarm channel, and a signed release APK'
		],
		notIncluded: [
			'No Play Store listing — sideload the APK',
			'No iOS build',
			'No repeating tasks',
			'No Windows or macOS bundle'
		]
	}
];

/**
 * Internal links. A route that appears in the navigation must appear here, or the
 * nav test fails — which is the point of listing them.
 */
export const routes = ['/', '/download', '/privacy', '/changelog'] as const;

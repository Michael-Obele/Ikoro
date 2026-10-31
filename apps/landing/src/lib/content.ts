/** Every claim the site makes; `tests/content.test.ts` compares it against the rendered markup. */

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
	 * `released` = downloadable; `unreleased` = built, no download; `building` = planned;
	 * `preview` = runs with limits; `unsupported` = will not work.
	 */
	status: 'released' | 'unreleased' | 'building' | 'preview' | 'unsupported';
	detail: string;
	/** Where the row's action goes. Absent when there is nothing to click. */
	href?: string;
	action?: string;
}

/** What each published file is: `label` is the button, `note` decides whether it is for them. */
export const assetLabels: Record<AssetKind, { label: string; note: string }> = {
	apk: { label: 'APK', note: 'Sideload on Android 8 or later.' },
	deb: { label: 'DEB', note: 'Debian, Ubuntu, Zorin, Mint.' },
	appImage: { label: 'AppImage', note: 'Any Linux. Make it executable, then run it.' },
	rpm: { label: 'RPM', note: 'Fedora, openSUSE. Built only when the runner can.' }
};

/**
 * What the site may say about the release. `building` is normal while the Android and Linux
 * builds upload minutes apart, and must be said out loud -- a button that 404s is worse.
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

/** Home page and /download. Size and date clauses appear only when the release knows them. */
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

	// Only files GitHub reported, with the size when it reported one.
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

/** Bytes to megabytes with one decimal, e.g. `3.4 MB`. */
export function formatBytes(n: number): string {
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * ISO timestamp to an en-GB date. Locale and options are pinned so node tests and Netlify
 * prerender produce the same string.
 */
export function formatReleaseDate(iso: string): string {
	return new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	}).format(new Date(iso));
}

/** The Android row minus release facts; `platformRows` fills status, href and action. */
const androidBase: Omit<Platform, 'href' | 'action' | 'status'> = {
	id: 'android',
	name: 'Android 8 and later',
	detail:
		'Sideload the APK. The alarm is scheduled through Android itself with ' +
		'setAlarmClock, so it arrives with Ikoro closed. Verified on a physical Pixel ' +
		'with the app force-stopped. Not on the Play Store in this version — sideloading ' +
		'is how you install it.'
};

/** The Linux desktop row, same shape and same rule: the release decides whether it may claim a download. */
const linuxBase: Omit<Platform, 'href' | 'action' | 'status'> = {
	id: 'linux-desktop',
	name: 'Linux desktop',
	detail:
		'The same interface in its own window. Reminders fire with the app closed through ' +
		'systemd user timers, which is what makes Linux the one desktop build that keeps ' +
		'the promise. Ships as a .deb and an AppImage, plus an .rpm when the runner can ' +
		'build one.'
};

/** Rows the release cannot affect; Android and Linux come from `platformRows`. */
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

/** `released` only when the release is live and carries every promised file. */
function statusFor(r: ReleaseInfo, platform: PlatformKey): Platform['status'] {
	return isDownloadable(r, platform) ? 'released' : 'unreleased';
}

/**
 * Status, href and action come from the release, so a half-uploaded release never
 * claims a download it cannot serve.
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

/** A /changelog entry; nothing is hand-written, so no two places can disagree. */
export interface Release {
	/** Version without the `v`, from the tag GitHub published. */
	version: string;
	/** The day GitHub published it, `YYYY-MM-DD`. Empty when the date is unknown. */
	date: string;
	/** The release page, so a reader can check the entry against its source. */
	tagUrl: string;
	/** What the release says it changed, one line each. */
	included: string[];
	/** Files this release did not carry. */
	missing: string[];
}

/**
 * GitHub's release body as scannable lines: release-please's `###` sections and older
 * "What's Changed" blocks both reduce to their `* ` lines; bot lines are dropped.
 */
export function releaseNotes(body: string): string[] {
	return body
		.split('\n')
		.filter((line) => line.startsWith('* '))
		.map((line) =>
			line
				.slice(2)
				.replace(/\s*\(\[[0-9a-f]{7,40}\]\([^)]*\)\)/g, '')
				.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
				.replace(/\*\*/g, '')
				.replace(/\s+/g, ' ')
				.trim()
		)
		.filter((line) => line.length > 0 && !line.includes('github-actions[bot]'));
}

/** The release list as changelog entries, newest first. */
export function releaseEntries(releases: ReleaseInfo[]): Release[] {
	return releases.map((release) => ({
		version: release.version,
		date: release.publishedAt?.slice(0, 10) ?? '',
		tagUrl: release.tagUrl,
		included: releaseNotes(release.body ?? ''),
		missing: ASSET_ORDER.filter((kind) => release.assets[kind] === undefined).map(
			(kind) => `No ${assetLabels[kind].label} on this release`
		)
	}));
}

/** Internal links; a route in the navigation must appear here or the nav test fails. */
export const routes = ['/', '/download', '/privacy', '/changelog'] as const;

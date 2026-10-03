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

export const site = {
	name: 'Ikoro',
	pronunciation: 'ih-KOR-oh',
	tagline: 'The gong that calls you.',
	/** Kept in step with apps/app/package.json. One product, one number. */
	version: '0.1.0',
	repo: 'https://github.com/Michael-Obele/Ikoro',
	releases: 'https://github.com/Michael-Obele/Ikoro/releases',
	issues: 'https://github.com/Michael-Obele/Ikoro/issues'
} as const;

/**
 * Shown on the home page and on /download until the first release exists. Delete
 * the field and the two callouts on the day `v0.1.0` is published — the buttons
 * are already pointing where the file will be.
 */
export const releaseNotice =
	'v0.1.0 has not been published yet. Nothing here is a download until it is: the ' +
	'links below point at the releases page, and they start working when a release is cut.';

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

/** The honest platform table. Nothing here promises a capability M8 did not observe. */
export const platforms: Platform[] = [
	{
		id: 'android',
		name: 'Android 8 and later',
		status: 'unreleased',
		detail:
			'Sideload an APK. The alarm is scheduled through Android itself, so it ' +
			'arrives with Ikoro closed. Not on the Play Store in this version — sideloading ' +
			'is how you install it.',
		href: site.releases,
		action: 'Releases page'
	},
	{
		id: 'linux-desktop',
		name: 'Linux desktop',
		status: 'building',
		detail:
			'The desktop build is the same interface with its own window. It has not been ' +
			'built yet. Whether it can schedule a reminder while closed is decided when it ' +
			'is, and this table will say whichever answer that turns out to be.'
	},
	{
		id: 'windows-macos',
		name: 'Windows and macOS',
		status: 'unsupported',
		detail:
			'Ikoro runs, and reminders fire while it is running. Reminders that arrive ' +
			'with the app closed are not supported on desktop in this version: the desktop ' +
			'shell this project uses cannot schedule a notification — it shows one ' +
			'immediately — so there is nothing honest to offer here yet.'
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

/** The same table as the short version, for the home page. */
export const limits: string[] = [
	'Windows and macOS reminders only fire while Ikoro is running.',
	'The browser build only reminds you while the tab is open.',
	'No repeating tasks and no subtasks in this version.',
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
		claim: 'Nothing is written to your browser.',
		detail:
			'This site sets no cookies and uses no local storage. Your browser cache may ' +
			'keep the page files, which is what a cache is for.'
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
		version: '0.1.0',
		date: 'in progress',
		summary:
			'The first version. Lists and tasks, three screens, Android alarms scheduled ' +
			'by the operating system, and a JSON backup you can read without this project.',
		included: [
			'Lists: create, rename, reorder, delete',
			'Tasks: title, note, date, time, priority, subtask field reserved but unused',
			'Today, Upcoming, Lists and Done screens',
			'Android exact alarms, scheduled with the operating system, not by the app',
			'A banner that appears when notification or exact-alarm permission is missing',
			'Reminders rescheduled when the app comes back to the foreground',
			'JSON export and import of every list and task'
		],
		notIncluded: [
			'No desktop shell, so no Windows or macOS build',
			'No sync, and no account',
			'No repeating tasks and no subtasks',
			'No Play Store listing',
			'No iOS build'
		]
	}
];

/**
 * Internal links. A route that appears in the navigation must appear here, or the
 * nav test fails — which is the point of listing them.
 */
export const routes = ['/', '/download', '/privacy', '/changelog'] as const;

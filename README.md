<p align="center">
	<img src=".github/assets/banner-dark.svg" alt="Ikoro. You set a time, and the alarm fires at that time." width="100%">
</p>

<p align="center">
	<img src="apps/app/static/icons/icon-192.png" alt="The Ikoro app icon: a white slit gong struck by a crimson mallet, on a near black tile." width="104" height="104">
</p>

# Ikoro

> **You set a time. The alarm fires at that time.** Even with the app closed, the screen off, and Doze mode on.

Local-first task and reminder app for **Android (Capacitor)** and **desktop (Tauri)**, in one **Bun-workspaces monorepo**, with a landing site and a self-hosted sync server.

<p align="center">
	<a href="#testing"><img src="https://img.shields.io/badge/tests-424%20passing-brightgreen" alt="424 tests passing"></a>
	<a href="#build-the-android-app"><img src="https://img.shields.io/badge/platform-Android%20%7C%20Linux-blue" alt="Platforms: Android and Linux"></a>
	<a href="https://bun.sh"><img src="https://img.shields.io/badge/bun-1.4.0-black" alt="Built with Bun 1.4.0"></a>
	<a href="https://svelte.dev"><img src="https://img.shields.io/badge/SvelteKit-3-ff3e00" alt="SvelteKit 3"></a>
	<a href="#licence"><img src="https://img.shields.io/badge/licence-not%20chosen-lightgrey" alt="Licence not chosen yet"></a>
</p>

---

## Contents

- [Why this exists](#why-this-exists)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Build the Android app](#build-the-android-app)
- [Install it on your phone](#install-it-on-your-phone)
- [Project layout](#project-layout)
- [Testing](#testing)
- [Project status](#project-status)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Licence](#licence)

## Why this exists

Most reminder apps are honest about exactly one thing: they will get to you when they get to you. A reminder that arrives 20 minutes late is not a reminder, it is a notification, and the difference matters most at the moment you were relying on it.

Ikoro makes one promise. **You set a time, and the alarm fires at that time.** Everything else in the app exists to keep that promise or stay out of its way.

On Android that means a real alarm, not a banner:

- `AlarmManager.setAlarmClock()`, so the system treats Ikoro as an alarm app. It is exempt from Doze and app standby, and Android lets it start a foreground service from the background.
- A foreground service that rings. It loops the ringtone on the **alarm** audio stream, so it plays at alarm volume and breaks through Silent, then vibrates until you deal with it.
- A full-screen alarm screen over the lock screen, with **Snooze** and **Dismiss**. It opens even when the app has been killed.
- Reminders re-arm after a reboot, and a second alarm arriving mid-ring takes over the screen instead of stacking behind the first.
- If you refuse the exact-alarm permission, Ikoro says so and refuses to arm. It never quietly downgrades you to an alarm that might be late.

While it rings, the app listens to nobody: it is still offline-first, so your tasks live in IndexedDB on the device and sync is optional.

## Requirements

| To do this | You need |
| --- | --- |
| Run anything | [Bun](https://bun.sh) 1.4.0, Node 22.17 or newer |
| Build the Android app | JDK 21 and the Android SDK (platform 36, build-tools) |
| Build the desktop app | Rust 1.97 or newer (Tauri) |
| Run the sync server | Postgres, or a Neon connection string |

Never use `npm`, `npx`, `pnpm`, or `yarn` here. They produce a different lockfile and the repo is Bun-only on purpose.

## Quick start

```bash
bun install                  # install every workspace
bun run scaffold             # create or repair the directory tree (idempotent)
bun run check                # svelte-check + tsc, every workspace
bun run test                 # vitest, every workspace
bun run --filter app dev     # start the product app (ask first, see below)
```

**Ask before you start a dev server, run a build, or deploy.** One dev server is usually already running on this machine, so check first rather than starting a second. The one exception is the debug APK below: that build is the deliverable, so the agent runs it without asking.

## Build the Android app

Three commands, from the repo root. This is the whole build:

```bash
cd apps/app
bun run build                  # vite build -> build/ (the static SPA)
bunx cap sync android          # copy build/ into the Android project
cd android && ./gradlew assembleDebug
```

The artifact lands at:

```
apps/app/android/app/build/outputs/apk/debug/app-debug.apk
```

**The first build takes about 16 minutes** while Gradle downloads its toolchain. Later builds are far quicker. If `assembleDebug` fails on the very first run with a toolchain error, the JDK is the usual cause; check `java -version` reports 21.

Bump `version` in `apps/app/package.json` before a build you intend to install as an update. `versionCode` is derived from it (`0.1.0` becomes `100`), so an unchanged version looks like the same build to Android.

## Install it on your phone

### Over USB

```bash
adb devices          # the phone must appear with state `device`
adb install -r apps/app/android/app/build/outputs/apk/debug/app-debug.apk
```

- `unauthorized`: unlock the phone, accept the debugging prompt, run `adb devices` again.
- `-r` reinstalls over the installed app and keeps your data.
- `INSTALL_FAILED_UPDATE_INCOMPATIBLE`: the installed copy was signed with a different key. Run `adb uninstall com.michaelobele.ikoro` and install again.

### Without USB

Your phone is not always plugged in, so here is the route that needs no cable:

1. Copy `app-debug.apk` to the phone however you like. A cloud drive, a chat to yourself, or a local network share all work. It is about 4.5 MB.
2. Open it from the **Files** app.
3. Android asks to allow **Install unknown apps** for whatever opened it. Allow it, then install.
4. Re-installing over an existing Ikoro needs the **same signing key**. Debug builds replace debug builds. A debug APK will not install over a release build, or the other way round.

The version the app was built with is shown in Settings, so you can confirm the update landed.

## Project layout

```
ikoro/
├── apps/
│   ├── app/       ⭐ the product, SvelteKit static SPA → Capacitor (Android) + Tauri (desktop)
│   ├── landing/   marketing site, SvelteKit static → Netlify
│   └── server/    sync API, SvelteKit adapter-node on Bun
├── packages/
│   └── sync/      wire protocol: Valibot schemas + LWW merge, used by app + server
├── AGENTS.md      the agent working agreement, tracked, the only agent-instruction file
└── scripts/       repo tooling
```

**shadcn-svelte components live per app.** `apps/app/src/lib/components/ui/` and `apps/landing/src/lib/components/ui/`, each with its own `components.json` and its own `index.ts` listing what that app exports. There is no shared UI package, because shadcn-svelte has no monorepo CLI routing and a central one bought only indirection. (`packages/ui` existed once. It was removed.) `packages/sync` is the one shared package, because it is a wire protocol rather than a component library.

## Testing

```bash
bun run test         # every workspace
cd apps/app && bun run test:watch   # while iterating on one file
```

Current state, measured 2026-10-04:

| Workspace | Files | Tests |
| --- | --- | --- |
| `apps/app` | 14 | 265 |
| `apps/server` | 9 | 128 |
| `@ikoro/sync` | 1 | 17 |
| `apps/landing` | 1 | 14 |
| **Total** | **25** | **424** |

A green run that executed nothing is worse than a red one. Check that the test count is not zero, and that the files you expected actually ran.

**`bun run check` and `bun run test` do not cover `bun run build`.** A `.svelte.ts` module can pass both and still break the production build, which is how a module-level `$derived` export once reached `master` with everything green. Run `bun run build` before you claim a UI change works.

## Project status

Built through M11. The Android app, the desktop shell, the landing site and the sync server exist and are committed.

**The alarm's core promise is verified on real hardware.** On a Google Pixel 10 Pro XL (Android 17, SDK 37), an exact alarm was scheduled with no warning from the platform, and the notification arrived on the `reminders` channel with the app force-stopped and the device forced idle. Measured drift was **+1 second**, against a promise of ±60.

What that does **not** mean, stated plainly:

- Rows for screen-off, battery saver, reboot and tap-through have not been run.
- The Google Tasks parity walkthrough has not happened.
- Nobody has looked at both themes by eye.
- `v0.1.0` is deliberately **not tagged**, because tagging a version whose headline feature is only partly verified makes the tag itself the claim.

`v1` ships when the whole QA matrix passes, not when the code compiles.

Not started: M12 (backlog views) and iOS.

## Troubleshooting

**`bun run build` passes but the APK is stale.** The artifact is only rebuilt by `assembleDebug`. Run all three commands in order; `bunx cap sync android` is the step people skip.

**The alarm does not fire at all.** Check Settings and the in-app banner for the exact-alarm permission. Android revokes it occasionally, and revoking it deletes alarms already scheduled.

**Reminders vanished.** "Force stop" on Ikoro makes Android delete everything the app scheduled, and the app has no way to tell you. Turn notifications off instead if you want silence.

**`INSTALL_FAILED_UPDATE_INCOMPATIBLE`.** Different signing key, as above. Uninstall, then install.

## Contributing

Read [`AGENTS.md`](./AGENTS.md) first. It is the working agreement for this repository and it carries the rules inline, because the build plan it was written against is not committed here.

The short version:

- Bun only.
- Ask before a dev server, a build, or a deploy.
- One milestone per commit. Never commit on a red harness.
- Never fabricate a test result, a screenshot, or a claim that something works.

## Documentation

The full build plan (`docs/HANDOVER.md`, `docs/build/M0` through `M11`, `docs/design/`, `docs/QA.md`) is **local-only and gitignored**. It travels with the machine that wrote it, not with the repository.

Cloning and building works without it. You only need `docs/` if you are the one executing the plan. If it is not on your machine, `AGENTS.md` plus the code is enough to work here, and it is the source everyone should trust: where the plan and the code disagree, the code wins.

## Licence

No licence has been chosen yet. The repository is private and Ikoro is not published. When that changes, this section gets the licence text and the badge above links somewhere real.


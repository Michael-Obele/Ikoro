# Ikoro — Decisions, risks, open questions

> [!WARNING]
> **Partially superseded.** D13 says Prisma v6 (it is 7.x), D2's desktop promise is not achievable, and the R9 passkey-bootstrap question is resolved. Five further decisions (D16–D20) were taken on 2026-10-03 and are appended below. See [`RESEARCH-2026-10.md`](../RESEARCH-2026-10.md).

Back to [README](./README.md).

## Decision log

| #  | Decision | Alternatives considered | Why (trade-off) | Date |
| -- | -------- | ----------------------- | --------------- | ---- |
| **D1** | **Staged alarms:** Tier 1 exact notifications in v1 → Tier 2 full alarm (custom Kotlin) in v2 | Alarm-grade from day 1; notifications-only | Ship fast, prove the core promise with the *official* plugin first; keep the wake-me tier as a spec'd upgrade. User chose "stage it". | 2026-09-25 |
| **D2** | **Platforms: Android (Capacitor) + desktop (Tauri) + landing + sync server; PWA dropped, iOS deferred** | Android+PWA (original 2026-09-25); Android+iOS; day-1 iOS | The exact-alarm battle is Android-only; desktop is cheap (one shared static build + Tauri notification plugin) and sidesteps mobile OS restrictions; PWA replaced per user's 2026-09-26 monorepo re-think; iOS adds 64-notification caps + FSI entitlement work for zero v1 learning. | 2026-09-25 · rev. 2026-09-26 |
| **D3** | **Local-first with sync as phase B:** the local store = source of truth always; self-hosted sync lands at M9–M11 after the app proves itself; JSON backup from day one | Self-hosted sync day 1; Google Tasks sync day 1; never-sync (PWA-era) | Zero servers/accounts until the alarm promise ships; Google's API can't carry times or recurrence ([google-tasks.md §2](./google-tasks.md)) — it never becomes the primary sync, only an import path. User confirmed order: App → Desktop → Site+Server. | 2026-09-25, rev. 2026-09-26 |
| **D4** | **SvelteKit + `adapter-static` SPA** (ssr=false) | Plain Svelte+Vite; SvelteKit SSR | One codebase serves Capacitor *and* PWA; user preference for SvelteKit; SSR is dead weight offline. Cost: SvelteKit routing without server features (none needed). | 2026-09-25 |
| **D5** | ~~Dexie over `@capacitor-community/sqlite`~~ — **superseded 2026-10-03 (D23): use `svelte-idb` 0.1.6, the user's own package** | Dexie 4; SQLite plugin; Capacitor Preferences | Still one storage path for WebView + browser, and JSON export is still trivial — but the library is now Michael's own, so the app dogfoods it. Accepted costs: **no transactions** (worked around with single-record writes, soft deletes, and a dirty-flag sync queue) and **non-reactive indexed queries**. | 2026-09-25 · rev. 2026-10-03 |
| **D6** | **No recurring tasks in v1** (field reserved) | Full recurrence day 1 | Google-parity recurrence needs re-arm semantics for alarms (each instance) — v1.1 after the engine is proven. Schema already carries `repeat`. | 2026-09-25 |
| **D7** | **Name = Ikoro** | Gbom, Saghi, Mezame (veto), Todoke (rejected), Lest/Peal | Equal score with Gbom but fluency wins; zero collisions; pairs with Aghara. Full scorecard: [naming.md](./naming.md). | 2026-09-25 |
| **D8** | **Due time stored separately (`dueDate` + `dueTime`)**, time never syncs | Single `dueAt` datetime | Google Tasks API discards time ([google-tasks.md §2](./google-tasks.md)) — split columns make the future sync mapping lossless for dates and honest about times. | 2026-09-26 |
| **D9** | **Battery-optimization prompt offered (sideload build)** | Silent; Play-managed | Brutus/field evidence: OEM killers are the residual risk after exact alarms. Sideload isn't bound by Play's `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` restrictions; if we ever ship on Play, revisit (R1). | 2026-09-26 |
| **D10** | **Missed-alarm detection surfaced as a banner** (reconcile on every open) | Fail silently like everyone else | The product promise is trust — an alarm that didn't fire must become visible + one-tap fixable ([alarms.md §2.5](./alarms.md)). | 2026-09-26 |
| **D11** | **Bun-workspaces monorepo** (`apps/*` + `packages/*`), no Turborepo yet | Single repo with copy-paste; Turborepo/Nx day 1 | Three deployables + two shells must share one codebase; `bun run --filter` covers our size — add caching only when build time actually hurts. Potholes documented in [research.md §8](./research.md). | 2026-09-26 |
| **D12** | **Landing and server = two apps** (`apps/landing`, `apps/server`) | One merged `apps/site` | User's own rule (2026-09-26): "if the server needs to run always → two apps" — SSE makes the API inherently always-on, and the marketing page must not die with the API. Landing = static/Netlify, API = Fly.io (revised 2026-10-03 — D22). | 2026-09-26 · rev. 2026-10-03 |
| **D13** | **Server stack: SvelteKit adapter-node on Bun + Neon + Drizzle ORM + Better Auth (passkey) + SSE, no Redis** | Hono/Express; Prisma; Supabase/Firebase; Redis day 1 | The user's standing stack (Drizzle + Neon + Better Auth) plus an explicit correction on 2026-10-03 — *"for the server we should be using drizzle not prisma"*. SSE with an in-process subscriber set needs no pub/sub at one instance — Redis enters only if multi-instance ([research.md §8](./research.md)). User: passkey auth + SSE realtime. | 2026-09-26 · rev. 2026-10-03 |
| **D14** | **Sync protocol: outbox + per-record LWW + tombstones + rev cursor** | CRDT (ElectricSQL/Yjs); operational transform; last-write-wins without tombstones | One user, two devices, no concurrent editing of the same record — CRDT complexity buys nothing; tombstones are required for delete propagation. Standard local-first pattern ([research.md §8](./research.md)). | 2026-09-26 |
| **D15** | **Svelte Native: never for this project (re-evaluate only on trigger)** | Svelte Native / NativeScript; Lynx (custom renderer) | Not officially supported by Svelte or NativeScript, semi-maintained, no Svelte 5 support (Mainmatter 2025-05), and it would force a full UI rewrite with zero Tailwind/shadcn sharing — the opposite of D11. Triggers to revisit: measured WebView jank on low-end hardware, or Svelte custom-renderer + NativeScript maturing. Evidence: [research.md §8](./research.md). | 2026-09-26 |

### Decisions added 2026-10-03 — see [RESEARCH-2026-10.md](../RESEARCH-2026-10.md) §2 for the full rationale

| #   | Decision | Alternatives | Why (trade-off) | Date |
| --- | -------- | ------------ | --------------- | ---- |
| **D16** | **Desktop alarms are OS-scheduled, Linux first** — per-alarm systemd user timer + oneshot service units, `Persistent=true`, driven from Rust commands in the Tauri shell. Windows/macOS are an explicit M12 TODO. The in-process timer stays as the fallback where no user systemd session exists, and the UI says which mode is active. | In-process timer only; Windows/macOS OS APIs now; a third-party plugin; dropping desktop. | Tauri's official plugin cannot schedule on desktop at all (RESEARCH F1). The user's own desktop is Linux and its primitives are verified present (F13), so it is the cheapest OS to make true. Sequencing the other two later avoids three privileged implementations before Phase A can end. Supersedes D2/M6's "fires with the app closed" claim. | 2026-10-03 |
| **D17** | **Adopt SvelteKit 3** — kit config in `vite.config.ts`; prove shadcn-svelte still works (via a `$lib` alias, or migrate to `#lib`). | Pin Kit 2 and keep `svelte.config.js`. | Kit 3 is what `sv create` produces; pinning 2 means starting on a legacy branch and fighting the CLI. The shadcn-svelte interaction is unproven, so it is a hard M0 gate with a written fallback. | 2026-10-03 |
| **D18** | **Schedule with `isExactNotification: true` + `isExactMandatory: true`**, and treat any `ScheduleResult.warning` as a broken promise shown to the user. | Accept the plugin defaults (silent fallback to an inexact alarm). | The product's promise is exact timing; a silent degradation is indistinguishable from a working alarm until it fails in front of the user. `@capacitor/local-notifications` 8.3.0+ makes this observable. | 2026-10-03 |
| **D19** | **Prisma 7.10.0, pinned**, with `@prisma/adapter-neon`, a root `prisma.config.ts`, and the `prisma-client` generator with an explicit `output`. | Stay on Prisma 6; install unpinned. | `prisma`'s `latest` dist-tag currently points at an 8.x **release candidate**, so an unpinned install mixes an RC CLI with a 7.x client. Prisma 7 already requires a driver adapter for Neon; adopting it now avoids a forced migration. Better Auth compatibility is an M10 verification with a `prisma-client-js` fallback. | 2026-10-03 |
| **D20** | **Auth = passkey-first registration + ≥ 2 passkeys + `twoFactor({ allowPasswordless: true })` recovery codes.** No email infrastructure. | Email OTP / magic-link recovery; a password fallback; single passkey with DB-level recovery. | Passkey-first registration is verified to exist (`registration.requireSession: false` + `resolveUser` + `createSession`), which closes R9's fallback. Recovery codes are available to passwordless users via the 2FA plugin. Whether `verifyBackupCode` works *cold* is an M10 verification, not an assumption. | 2026-10-03 |
| **D21** | **`packages/ui` is consumed as a source package** — no `svelte-package` build step. | Build to `dist/` with `svelte-package`. | Both consumers are Vite/SvelteKit and compile `.svelte` source directly, removing the `dist/package.json` resolution quirk (R11) and a build step. The package is private, so publishability has no value. | 2026-10-03 |
| **D22** | **Deploy `apps/server` to Fly.io, not Koyeb.** | Koyeb (the original plan and the Aghara pattern). | The user already has a Fly.io account (2026-10-03, their call). Same shape: Bun container + `adapter-node`, one always-on machine with `auto_stop_machines = false` so SSE subscribers survive. | 2026-10-03 |

## Out of scope (per current plan)

iOS · telemetry/analytics · Google two-way sync (import only) · recurring tasks · subtasks UI · snooze/full-screen alarms (Tier 2) · tags · search · Calendar/Gmail integration · Play Store publication (sideload first) · i18n (English only) · tablet layout · public browser web app · Redis · CRDTs.

## Risks

| #  | Risk | Likelihood | Mitigation |
| -- | ---- | ---------- | ---------- |
| **R1** | Play Store rejects exact-alarm/FSI/battery permissions if we ever publish | High (if published) | v1 = sideload APK (no Play rules). At publication: declare alarm category, `USE_EXACT_ALARM`-eligible story, FSI default-grant for alarm apps ([research.md §3](./research.md)). |
| **R2** | OEM killers (Samsung/Xiaomi) drop alarms despite exact scheduling | Medium | Battery-optimization prompt (D9) + missed-detection banner (D10) + Samsung manual pass in M8 matrix. Tier 2 `setAlarmClock` as backstop. |
| **R3** | Plugin boot-restore fails on OEM quick-boot (`LOCKED_BOOT_COMPLETED`) | Medium | Spike M4-S1 verifies; `rescheduleAll()` self-heals on every app open ([alarms.md §2.4](./alarms.md)). |
| **R4** | ~~Desktop scheduling weak on Linux~~ — **resolved 2026-10-03:** Linux now schedules with systemd user timers and fires with the app closed (D16). The residual risk moved to **Windows/macOS**, which cannot be scheduled until M12 | Medium (Win/macOS only) | Linux is covered by D16/F13. For Windows/macOS the app falls back to the in-process timer and states the limitation in the UI, rather than promising a delivery it cannot make. |
| **R5** | Android 14+ denies FSI/exact by default → degraded UX | High (defaults) | Permission health panel + deep-links; banner explains consequences in one sentence (Brutus pattern). |
| **R6** | Name collision appears later (app/store) | Low | Re-check gate before publishing ([naming.md](./naming.md)); npm/GitHub/web were green on 2026-09-25. |
| **R7** | IndexedDB data loss (browser site-data eviction on the preview build / user clears site data) | Low–Med | Export reminder after first week of use and on settings visit; storage persistence probe surfaced in settings. |
| **R8** | Spike M4-S1 fails on device → core promise unverifiable | Low | **Hard gate**: no UI work until device-verified ([milestones.md M4-S1](./milestones.md)); fallback path = Tier-2 plugin brought forward (re-plan, don't force). |
| **R9** | Better Auth passkey bootstrap gap (passkeys may need an existing account) + user lockout | Medium | Verify at M10 with fallback = username + passkey (no email); **backup codes mandatory at signup** and downloadable — lockout = lost account otherwise. |
| **R10** | Server outage / Fly.io machine restart | Medium | Local-first by design: app fully works offline; sync status surfaced in settings (Synced/Syncing/Offline); landing is a separate deploy (D12) so the site stays up. |
| **R11** | Monorepo package-extraction churn (`svelte-package` dist quirks) | Medium | Lazy package rule: extract only on second consumer (M9), app-green gate before proceeding; `packages/config` deferred until duplication hurts. |

## Open questions (re-check at build time)

- [ ] Plugin boot-restore across OEM quick-boot (M4-S1 evidence) — R3.
- [ ] Google Tasks API: quota numbers; subtask depth; where "stars" live ([google-tasks.md §5](./google-tasks.md)).
- [ ] Tauri notification plugin pending-query API (needed for reconcile missed-detection on desktop) — verify at M6; fallback documented in [milestones M6 Step 4](./milestones.md).
- [ ] Better Auth: does passkey-first **sign-up** exist without an existing account? (M10, R9.)
- [ ] `@prisma/adapter-neon` + Better Auth Prisma adapter combination works on Bun/adapter-node (M10).
- [ ] `svelte-package` dist/`package.json` import quirk when extracting `packages/ui` (M9, R11).
- [ ] Neon account + `DATABASE_URL`, Fly.io deploy, Netlify deploy, landing domain — **Michael's calls; ask before each deploy.** (All three accounts exist as of 2026-10-03.)
- [ ] Channel sound attributes: confirm `USAGE_ALARM` vs `USAGE_NOTIFICATION_RINGTONE` mix on device (M8 listening test).
- [ ] App name/version in launcher + settings ("Ikoro — beta"?)

## Assumptions

- Michael's dev server runs on a known port — agents ask, never start one (standing rule).
- Sideload install (adb) is available for testing; a physical Android device exists for M4/M8; desktop testing on at least one of Windows/macOS/Linux.
- Rust toolchain is already installed on this machine (rustc/cargo 1.97.1) — M6 Step 0 needs no download; Neon, Fly.io, Netlify and GitHub Releases are all available; a physical Android device exists; **every deploy still needs explicit approval**.
- "Alarm-grade" v1 bar = Tier 1 exact notifications; waking from sleep is explicitly v2 (Tier 2).

---

Back to [README](./README.md) · Related: [research.md](./research.md) · [alarms.md](./alarms.md) · [milestones.md](./milestones.md)

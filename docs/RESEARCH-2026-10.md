# RESEARCH — what changed, 2026-10-03

The original plan was written on 2026-09-25/26 against the package versions of that day. This file records what a fresh round of verification found on **2026-10-03**, what it invalidates, and the decisions taken. Where this file and `design/` disagree, this file wins.

Method: npm registry dist-tags queried directly; vendor documentation read at source (`v2.tauri.app`, `better-auth.com`, `svelte.dev/docs/kit`, `@capacitor/local-notifications` docs); upstream issue trackers checked for the scheduling question. No claim below is from memory.

---

## 1. Findings

### F1 — Tauri cannot schedule notifications on desktop ⚠️ **product-affecting**

The official plugin's reference says, verbatim:

> "Build one with the static `Schedule.at`, `Schedule.interval` and `Schedule.every` helpers, then pass it to the `schedule` option of a notification. **Scheduling is only supported on mobile; desktop notifications are always shown immediately.**"

Corroborated by the plugin's own response to a Windows user: *"schedule is only supported on mobile. I think this is the relevant tracking issue for desktop support"* — [plugins-workspace#2141](https://github.com/tauri-apps/plugins-workspace/issues/2141), opened 2022-09-17 and still open; [#2313](https://github.com/tauri-apps/plugins-workspace/issues/2313), answered 2025-01.

Also relevant: `pending()` exists but is documented "only supported on mobile", and there is no cancel API. So on desktop there is **no way to arm, enumerate, or cancel** a notification that outlives the process.

`design/research.md` §8 and `design/architecture.md` §9 both claim Windows/macOS deliver OS-scheduled notifications with the app closed. **That is wrong for the official plugin.**

→ **Decision D16.**

### F2 — SvelteKit 3 is the current release, and it moved the config

`@sveltejs/kit` is at **3.0.0**. Breaking changes that hit this repo directly ([migration guide](https://svelte.dev/docs/kit/migrating-to-sveltekit-3)):

- `svelte.config.js` is **no longer supported**; kit options move into the `sveltekit()` Vite plugin in `vite.config.ts`.
- `vitePlugin` is **removed** — options such as `inspector` move up one level into the plugin call.
- `$lib` is **no longer auto-generated** → `#lib` via `package.json#imports`, needing explicit file extensions.
- `$app/environment` → `$app/env`; `$service-worker` removed.
- `prerender.origin` → `paths.origin`; for `adapter-node` this replaces the `ORIGIN` env var.
- `invalidateAll` → `refreshAll`.
- Minimums: Node ≥ 22.17, TypeScript ≥ 6, Svelte ≥ 5.57.1, Vite ≥ 8.

Every M0/M3 snippet in `design/milestones.md` that edits `svelte.config.js` is therefore stale.

**Interaction with shadcn-svelte 1.7.0:** its docs and `components.json` still assume `$lib` + `svelte.config.js`. Whether `alias: { $lib: './src/lib' }` inside the Kit 3 plugin makes shadcn-svelte work unchanged is **not documented either way**, so it is a hard **M0 gate**, with a documented fallback to `#lib` aliases and a last-resort pin to Kit 2.

→ **Decision D17.**

### F3 — Capacitor's exact alarms now fail loud instead of degrading silently

Capacitor is at **8.x**. `@capacitor/local-notifications` **8.3.0** added:

- `isExactNotification` (default `true`) — on Android 12+, `schedule()` will open the system "Alarms & reminders" screen so the user can grant exact alarms; declining degrades the alarm to inexact and sets `ScheduleResult.warning`.
- `isExactMandatory` (default `false`) — if set, a denied permission makes `schedule()` **reject** rather than silently falling back.

`checkExactNotificationSetting()` / `changeExactNotificationSetting()` still exist, and the long-standing hazard is unchanged: **revoking the setting restarts the app and deletes already-scheduled exact notifications.**

This is strictly better than what the plan assumed (a silent fallback to inexact, undetectable from JS). It lets Ikoro keep the promise honest — a "successful" schedule carrying a warning is a broken promise and the UI can say so.

→ **Decision D18.**

### F4 — The server uses **Drizzle**, not Prisma (user correction, 2026-10-03)

> "for the server we should be using drizzle not prisma" — Michael, 2026-10-03

This matches the recorded stack choice across his other SvelteKit projects (Aghara, Kikitai): Drizzle ORM + PostgreSQL/Neon + Better Auth + Valibot, with config unified in `vite.config.ts`. Prisma was considered for Ikoro and rejected.

| Package                        | Version | Note |
| ------------------------------ | ------- | ---- |
| `drizzle-orm`                  | 0.45.3  | |
| `drizzle-kit`                  | 0.31.11 | dev — schema generation + migrations |
| `@neondatabase/serverless`     | 1.2.0   | the driver; `drizzle-orm/neon-http` wraps it |
| `@better-auth/drizzle-adapter` | 1.7.7   | keep in lockstep with `better-auth` |

Facts that change the M10 instructions:

- **The Better Auth adapter is now its own package.** Install `@better-auth/drizzle-adapter` and import `drizzleAdapter` from it; `better-auth/adapters/drizzle` is the legacy subpath.
- `drizzleAdapter(db, { provider: 'pg', schema })` — pass the `schema` object so relations resolve. The docs show `provider: 'pg'`.
- A **`relations-v2`** variant exists (`@better-auth/drizzle-adapter/relations-v2`) for Drizzle Relations v2 / `defineRelations`. **Not needed here** — the schema is hand-authored with `pgTable` and Relations v1 is sufficient.
- The schema is **authored by hand** (`pgTable` from `drizzle-orm/pg-core`), with the Better Auth tables emitted by `bunx auth@latest generate` and reconciled into the same file.
- Migrations: `bunx drizzle-kit generate` then `bunx drizzle-kit migrate`. No `prisma.config.ts`, no mandatory generator `output`.

→ **Decision D19 (revised).**

### F5 — Better Auth passkey-**first** registration exists ✅ (closes risk R9)

`passkey({ registration: { requireSession: false, resolveUser } })` plus `authClient.passkey.addPasskey({ context, createSession: true })`. Users can be created in `registration.afterVerification`, so nothing is written before the WebAuthn ceremony succeeds. The plan's fallback ("username + passkey") is not needed.

→ **Decision D20.**

### F6 — Recovery codes need `allowPasswordless: true`

Backup codes live in the **`twoFactor`** plugin, which by default refuses passwordless users. `twoFactor({ allowPasswordless: true })` unlocks `generateBackupCodes()` / `verifyBackupCode()`. Codes are one-shot.

Remaining unknown, to be settled at M10: whether `verifyBackupCode` works **cold** (without a preceding 2FA challenge), i.e. as a real recovery path for a user who has lost their only passkey. If not, recovery = require ≥ 2 registered passkeys + a documented DB-level reset.

→ **Decision D20.**

### F7 — Broad version drift

`design/` was written against SvelteKit 2, Capacitor 7, Prisma 6 (since replaced by Drizzle), and an earlier Vitest. Current values are in [`VERSIONS.md`](./VERSIONS.md) — that file is authoritative.

### F8 — This machine's toolchain is already sufficient

Node **v24.12.0** (≥ 22.17 ✔ for Kit 3), Bun **1.4.0**, rustc/cargo **1.97.1**, OpenJDK **21**, adb **1.0.41**. The Rust toolchain being present removes the M6 `rustup` multi-hundred-MB download the plan warned about.

### F9 — Desktop missed-detection cannot rely on a pending list

Because `pending()` is mobile-only (F1), the desktop equivalent of "still armed but in the past ⇒ it did not fire" is unavailable. Desktop reconciliation must instead compare `alarmAt` against a **last-seen-running timestamp** persisted on disk: if `alarmAt` passed while the app was not running, it is missed.

### F10 — Android revocation semantics unchanged

Revoking exact-alarm permission still restarts the app and wipes scheduled exact notifications. Re-check on every resume, and `rescheduleAll()` from the local store remains the self-healing backstop. No change to the plan — recorded because it is the failure the product must never hide.

### F11 — Google Tasks API constraints unchanged

`due` is date-only (time discarded), no `repeat`/`priority`/`reminder` fields, `parent`/`position` output-only. `design/google-tasks.md` remains accurate; nothing in it needs revision.

### F12 — Bun workspaces tolerate app directories with no `package.json`

Verified: with `apps/*` present as empty directories, `bun install` at the root reported `Checked 4 packages (no changes)`. So the repo can be installed before any generator has run — the scaffold order is not load-bearing.

### F13 — Linux OS-native alarm scheduling is viable (verified on this machine)

Checked 2026-10-03 on the dev machine: systemd **255**; a running **user** systemd instance (`systemctl --user is-system-running` → `running`); `/usr/bin/notify-send` present and working against the session bus (`DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus`); `/usr/bin/systemd-run` present; `~/.config/systemd/user/` already exists. **`at` and `atd` are not installed**, so an `at`-based scheduler is not an option.

Consequence: Linux can get **real** OS-level scheduling from per-alarm **systemd user timer + oneshot service** units, with `Persistent=true` giving catch-up for alarms that came due while the machine was off. `Linger=no` on this machine, so timers die at logout unless the user runs `loginctl enable-linger $USER` — a documented, user-performed step that the app must not assume.

### F14 — Storage is `svelte-idb` (the user's own package), and it has no transactions ⚠️ **design-affecting**

> "we shouldn't use Dexie schema we already have a package we made we can dog feed that" — Michael, 2026-10-03

`svelte-idb` **0.1.6** (<https://github.com/Michael-Obele/svelte-idb>) — zero-dependency, runes-native, SSR-safe IndexedDB wrapper, `peerDependencies: svelte ^5`, ~2 KB, MIT. Full API read from its published `.d.ts`; the details are in [`VERSIONS.md`](./VERSIONS.md) §2.6. Three facts changed the plan:

1. **No transaction API** — zero references to `transaction` in the published bundle; it is on the project's own roadmap. This kills the original M11 design ("enqueue the op in the same Dexie transaction as the write"), because with no transactions a write and its queue entry are two independent operations and either can be the one that survives. The replacement is a **dirty flag on the row itself** ([`build/00-conventions.md`](./build/00-conventions.md) §3.1): one `put()` marks the record changed *and* needing a push, so atomicity is inherent and no second store exists. Deletes become **soft** from day one for the same reason.
2. **Live queries are not index-aware** — only `liveAll()` / `liveGet()` / `liveCount()` are reactive; `where()` is core-only and labelled MVP. Filtered screens therefore subscribe with `liveAll()` and narrow with `$derived`, which is O(N) per mutation. Honest ceiling: low thousands of tasks. Isolated in `stores/view.ts` so upstream progress is a one-file change.
3. **`onUpgrade` is a raw hook** — you write the upgrade, svelte-idb does not infer it, and "migration sugar" is unfinished. The plan sidesteps it by declaring the **complete** schema — sync fields included — at `version: 1` in M1, so Phase A performs no upgrade at all.

→ **Decision D23.**

---

## 2. New decisions

Append these to `design/decisions.md` (D16–D20).

| #   | Decision | Alternatives | Why |
| --- | -------- | ------------ | --- |
| **D16** | **Desktop alarms are OS-scheduled, Linux first.** Linux gets real OS-level scheduling via per-alarm **systemd user timer + oneshot service** units (`Persistent=true` so a missed run catches up), driven from Rust commands in the Tauri shell. Windows and macOS are an explicit **TODO in M12**, not silently dropped. The in-process timer remains as the fallback when no user systemd session is available, and the UI states which mode is active. | In-process timer only (the earlier draft of this decision); Windows `ToastNotifier.AddToSchedule` + macOS `UNUserNotificationCenter` now; adopt a third-party plugin; drop desktop entirely. | The official plugin cannot schedule on desktop at all (F1). Linux is the user's own desktop and its primitives are verified present (F13), so it is the cheapest OS to do properly and it makes the promise true on the machine where it is developed. Doing all three at once means three fragile, privileged implementations before Phase A can end; the user chose to sequence them, Linux first. | 2026-10-03 |
| **D17** | **Adopt SvelteKit 3**, config in `vite.config.ts`, gated by an M0 compatibility check that also proves shadcn-svelte works (via a `$lib` alias, or by migrating to `#lib`). | Pin `@sveltejs/kit@2` + `svelte.config.js` and follow shadcn-svelte docs verbatim. | Kit 3 is what `sv create` produces; pinning 2 means fighting the CLI and starting on a legacy branch on day one. But the shadcn-svelte interaction is unproven, so the fallback is written down and the check is mandatory rather than assumed. |
| **D18** | **Use `isExactNotification: true` + `isExactMandatory: true`**, and treat any `ScheduleResult.warning` as a broken promise surfaced in the UI. | Leave the defaults (silent fallback to inexact). | The product's promise is exact timing. A silent degradation is indistinguishable from a working alarm until it fails in front of the user. Fail loud (F3). |
| **D19** | **Server data layer = Drizzle + Neon.** `drizzle-orm` 0.45.3 + `drizzle-kit` 0.31.11 over `@neondatabase/serverless` (`drizzle-orm/neon-http`); Better Auth via `@better-auth/drizzle-adapter`. Schema hand-authored with `pgTable`; migrations with `drizzle-kit generate`/`migrate`. | Prisma 7 (pinned) with `@prisma/adapter-neon`. | **User correction, 2026-10-03:** "for the server we should be using drizzle not prisma" — and it is the recorded choice on his other SvelteKit projects. Drizzle's schema is plain TypeScript, which suits a repo whose wire contracts are already Valibot-schema-first, and it avoids Prisma's mandatory driver adapter + forced generator `output` + separate config file. | 2026-10-03 |
| **D20** | **Auth = passkey-first registration + ≥ 2 passkeys + `twoFactor({ allowPasswordless: true })` backup codes.** No email infrastructure. | Email OTP / magic link recovery; password fallback; single passkey + DB-level recovery. | Passkey-first is verified to exist (F5) and recovery codes are available to passwordless users (F6), so the account model stays passwordless and email-free as planned. The cold-`verifyBackupCode` question is an M10 verification with a documented fallback, not an assumption. |
| **D21** | **`packages/ui` is consumed as a source package** — no `svelte-package` build step. | Build to `dist/` with `svelte-package`. | Both consumers are Vite/SvelteKit and compile `.svelte` source directly, so this removes the long-standing `dist/package.json` resolution quirk (R11) and a build step between edit and see. The package is private; publishability has no value here. | 2026-10-03 |
| **D22** | **Deploy `apps/server` to Fly.io, not Koyeb.** | Koyeb — the original plan, and the pattern used by the sibling Aghara project. | The user already has a Fly.io account (2026-10-03, their call). Same shape: a Bun container behind `adapter-node`, one always-on instance, secrets via `fly secrets set`. | 2026-10-03 |

---

## 3. Superseded statements in `design/`

Patch these in place when you next touch the file; until then, this table is authoritative.

| Document & location | Says | Correct statement |
| ------------------- | ---- | ----------------- |
| `design/README.md` — success criteria | "Desktop: scheduled notification fires with the app **closed** on Windows/macOS" | Desktop fires only **while the app is running** (D16). Win/macOS/Linux alike. |
| `design/architecture.md` §2 stack table | `SvelteKit` implying 2.x + `svelte.config.js` | SvelteKit **3.0.0**; config lives in `sveltekit({…})` in `vite.config.ts`; `$lib` → `#lib` unless aliased (D17, `VERSIONS.md` §2.1) |
| `design/architecture.md` §2 stack table | `Capacitor 7` | **Capacitor 8.5.2**; `@capacitor/local-notifications` **≥ 8.3.0** (D18) |
| `design/architecture.md` §2 stack table | `Prisma v6` (`@prisma/adapter-neon`) | **Drizzle** 0.45.3 + `@neondatabase/serverless`, Better Auth via `@better-auth/drizzle-adapter` (D19) |
| `design/architecture.md` §9 | Tauri: `send({ schedule: { at: … } })` schedules on Windows/macOS | Desktop ignores `schedule` entirely (F1) |
| `design/alarms.md` §1 capability matrix | Desktop: "Fires with app killed ✅ Win/macOS" | **❌** — desktop requires the app to be running (D16) |
| `design/alarms.md` §2.6 | Desktop "OS-scheduled on Windows/macOS (survives app closed)" | Removed. In-process timer + fire-on-open reconcile (D16, F9) |
| `design/milestones.md` M0 Step 3 | "edit `svelte.config.js`" | Config is in `vite.config.ts` (F2) |
| `design/milestones.md` M6 Step 4–6 | `schedule.at`, verify a pending-query API, "OS-scheduled fire with app closed" | No desktop scheduling; `pending()` is mobile-only; the pending-query verification is unnecessary and the app-closed acceptance criterion is void (F1) |
| `design/milestones.md` M10 Step 3 | `prisma@6`, `@prisma/client@6`, `@prisma/adapter-neon` | `drizzle-orm` + `drizzle-kit` + `@neondatabase/serverless`, Better Auth via `@better-auth/drizzle-adapter`, `pgTable` schema, `drizzle-kit generate`/`migrate` (D19) |
| `design/decisions.md` D13 | "Prisma v6" | Drizzle + Neon, Better Auth via `@better-auth/drizzle-adapter` (D19) |
| `design/decisions.md` D5 | "Dexie over `@capacitor-community/sqlite`" | **`svelte-idb` 0.1.6** — the user's own package (D23) |
| `design/architecture.md` §2 and §4, `design/milestones.md` M1, M3, M7, M11 | Dexie 4 schema, `Table<>`, `liveQuery()`, `db.transaction()`, `version(2)` at M11 | `svelte-idb` `createReactiveDB` + `liveAll()`/`$derived`; no transactions; soft deletes; dirty-flag sync queue; **single** `version: 1` (D23) |
| `design/decisions.md` R4 | "Desktop scheduling weak on Linux" | Superseded by D16 — it is not weak, it does not exist; the limitation is now all three desktop OSes |
| `design/decisions.md` R9 / open questions | "does passkey-first sign-up exist?" | **Resolved: yes** (F5). Replaced by a narrower question — does `verifyBackupCode` work cold? (F6) |
| `design/research.md` §8 | "Tauri v2 notification plugin schedules for real … Windows/macOS = OS-scheduled" | Mobile-only (F1) |
| `design/research.md` §8 + `VERSIONS` assumptions | Vitest 2/3-era API notes | Vitest **5.0.3**; the API used here is unchanged |

---

## 4. Still open (verify at build time, with a stated fallback)

| # | Question | Where | Fallback if the answer is "no" |
| - | -------- | ----- | ------------------------------ |
| 1 | Does `alias: { $lib: './src/lib' }` keep shadcn-svelte working under Kit 3? | **M0 gate** | `#lib` aliases via `components.json`; last resort pin Kit 2 (D17) |
| 2 | Can shadcn-svelte's CLI write into a Kit 3 project at all (it reads `components.json`, not `svelte.config.js`)? | M0 gate | Same as #1 |
| 3 | Does `verifyBackupCode` work **cold**, as a standalone recovery sign-in? | M10 | Require ≥ 2 passkeys; document a DB-level reset procedure |
| 4 | Does `@better-auth/drizzle-adapter@1.7.7` accept a `drizzle-orm/neon-http` instance with a hand-authored `pgTable` schema? | M10 | Generate the schema with `bunx auth@latest generate`; or switch the adapter to `@better-auth/drizzle-adapter/relations-v2` |
| 5 | Does the plugin's Android boot-restore survive OEM quick-boot (`LOCKED_BOOT_COMPLETED`)? | M4-S1 | `rescheduleAll()` self-heals on every open; document as best-effort |
| 6 | `drizzle-orm/neon-http` under `adapter-node` on Bun — the HTTP driver opens no pool, so confirm the client is constructed once and not per request | M10 | Keep the lazy singleton; or switch to the WebSocket driver (`drizzle-orm/neon-serverless`) if pooling is needed |
| 7 | Channel sound attributes: `USAGE_ALARM` vs `USAGE_NOTIFICATION_RINGTONE` | M8 listening test | Accept the plugin default and document it |

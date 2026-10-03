# VERSIONS — what to install, and the traps

Verified against the npm registry on **2026-10-03**. Unless a milestone says otherwise, these are the versions to end up with. Where a milestone uses a generator (`sv create`, `shadcn-svelte init`, `cap add`), the generator picks the version — then you **check it against this table** and correct if it drifted.

## 1. Pinned table

### SvelteKit workspace (all apps)

| Package                       | Version  | Notes |
| ----------------------------- | -------- | ----- |
| `svelte`                      | 5.57.1   | SvelteKit 3 requires ≥ 5.57.1 exactly-or-newer |
| `@sveltejs/kit`               | 3.0.0    | **major** — see §2.1 |
| `@sveltejs/vite-plugin-svelte`| 7.3.1    | |
| `vite`                        | 8.3.2    | **major** — Vite 8 = rolldown |
| `typescript`                  | 7.0.2    | Kit 3 requires ≥ 6; 7.x is current |
| `@sveltejs/adapter-static`    | 4.0.0    | apps/app, apps/landing |
| `@sveltejs/adapter-node`      | 6.0.0    | apps/server |
| `@sveltejs/package`           | 3.0.0    | packages/ui (M9) |
| `tailwindcss`                 | 4.3.3    | v4, CSS-first config |
| `shadcn-svelte`               | 1.7.0    | CLI: `bunx shadcn-svelte@latest` |
| `bits-ui`                     | 2.19.5   | pulled in by shadcn-svelte |
| `lucide-svelte`               | 1.0.1    | icons |
| `svelte-check`                | 4.7.6    | |
| `eslint`                      | 10.12.0  | let `sv add eslint` choose its own; don't force |
| `prettier`                    | 3.9.9    | |
| `sv-agentation`               | latest   | dev-only UI annotation layer (see HANDOVER §2.5) |

### Test toolchain

| Package                  | Version | Notes |
| ------------------------ | ------- | ----- |
| `vitest`                 | 5.0.3   | **major** vs the plan's assumption |
| `@testing-library/svelte`| 5.4.2   | |
| `jsdom`                  | 30.1.1  | |
| `fake-indexeddb`         | 6.2.5   | `import 'fake-indexeddb/auto'` **first**, before the module under test |

### apps/app

| Package                            | Version | Notes |
| ---------------------------------- | ------- | ----- |
| `svelte-idb`                       | 0.1.6   | the user's own package, dogfooded (D23) — see §2.6 |
| `valibot`                          | 1.5.0   | runtime validation |
| `runed`                            | 0.37.1  | **direct** dependency; check here before hand-rolling a utility |
| `svelte-dnd-action`                | 0.9.79  | drag-reorder (M2) |
| `@resvg/resvg-js`                  | 2.6.2   | dev-only, icon rasteriser (M5) |
| `@capacitor/core`                  | 8.5.2   | **major** — Capacitor 8, not 7 |
| `@capacitor/cli`                   | 8.5.2   | dev |
| `@capacitor/android`               | 8.5.2   | |
| `@capacitor/app`                   | 8.1.2   | `appStateChange` → reconcile |
| `@capacitor/local-notifications`   | 8.3.1   | **needs ≥ 8.3.0** — see §2.3 |
| `@tauri-apps/api`                  | 2.12.1  | |
| `@tauri-apps/cli`                  | 2.12.1  | dev |
| `@tauri-apps/plugin-notification`  | 2.5.1   | **desktop cannot schedule** — see §2.2 |

### apps/server

| Package                        | Version | Notes |
| ------------------------------ | ------- | ----- |
| `better-auth`                  | 1.7.7   | |
| `@better-auth/passkey`         | 1.7.7   | |
| `@better-auth/drizzle-adapter` | 1.7.7   | keep in lockstep with `better-auth` |
| `drizzle-orm`                  | 0.45.3  | |
| `drizzle-kit`                  | 0.31.11 | dev — schema generation and migrations |
| `@neondatabase/serverless`     | 1.2.0   | the driver; `drizzle-orm/neon-http` wraps it |

---

## 2. Traps

### 2.1 SvelteKit 3 moved the config out of `svelte.config.js`

`svelte.config.js` **is no longer supported**. Kit config now lives inside the `sveltekit()` plugin in `vite.config.ts`. The old `kit: { … }` keys become top-level plugin options:

```ts
// apps/app/vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter({
        pages: 'build',
        assets: 'build',
        fallback: 'index.html',
        precompress: false,
        strict: true,
      }),
      alias: { $lib: './src/lib' },   // see 2.1a
      inspector: {
        toggleKeyCombo: 'alt-x',
        showToggleButton: 'active',
        toggleButtonPos: 'bottom-left',
      },
    }),
  ],
});
```

Also in Kit 3:

- **`vitePlugin` is removed** — options like `inspector` are passed straight to the plugin (above).
- **`$lib` is no longer auto-generated**; it becomes `#lib`, declared under `imports` in `package.json`, and those imports need explicit extensions.
- `$app/environment` → `$app/env`; `$service-worker` removed (`$app/manifest` replaces it).
- `prerender.origin` → `paths.origin` (and for `adapter-node`, `paths.origin` replaces the `ORIGIN` env var).
- `invalidateAll` → `refreshAll`.
- Removed: `files.lib`, `experimental.handleRenderingErrors`, `experimental.instrumentation`, `preloadStrategy`, `csrf.checkOrigin`, `prerender.origin`.
- **Minimums:** Node ≥ 22.17, TypeScript ≥ 6, Svelte ≥ 5.57.1, Vite ≥ 8.0.12, `@sveltejs/vite-plugin-svelte` 7.

#### 2.1a The shadcn-svelte alias problem (M0 gate)

shadcn-svelte 1.7.0's docs and `components.json` still assume **`$lib`** and `svelte.config.js`. Kit 3 uses **`#lib`**. Two ways forward — **M0 must determine which one actually works before any app code is written:**

- **Preferred:** redeclare the old alias, `alias: { $lib: './src/lib' }` inside `sveltekit({…})`, and run `shadcn-svelte init` with the default `$lib` aliases. If `bunx shadcn-svelte add button` produces a component that `bun run check` accepts → done, keep it.
- **Fallback:** drop `$lib`, use `#lib` everywhere, and pass explicit aliases to the CLI (`--lib-alias '#lib' --components-alias '#lib/components' --ui-alias '#lib/components/ui' --utils-alias '#lib/utils' --hooks-alias '#lib/hooks'`). Note `#lib` imports need file extensions.
- **Last resort:** pin the previous generation — `@sveltejs/kit@2`, `@sveltejs/adapter-static@3`, `@sveltejs/vite-plugin-svelte@6`, keep `svelte.config.js`, and follow the shadcn-svelte docs verbatim. This is a deliberate downgrade: write it in `decisions.md` if you take it, with the reason.

Do **not** guess. Run the check, then record which branch you took in `docs/decisions.md`.

### 2.2 Tauri's official notification plugin cannot schedule on desktop

The docs are explicit:

> "Scheduling is only supported on mobile; desktop notifications are always shown immediately."

`send({ schedule: { at: … } })` is accepted but **ignored on desktop** — the toast appears at once. `pending()` is mobile-only, so there is no way to enumerate armed notifications on desktop either, and no cancel API.

**Consequence:** the original plan's "desktop notification fires with the app closed on Windows/macOS" is **not achievable with the official plugin** (upstream tracking: [plugins-workspace#2141](https://github.com/tauri-apps/plugins-workspace/issues/2141), open since 2022-09; the 2025-01 answer to [#2313](https://github.com/tauri-apps/plugins-workspace/issues/2313) confirms it).

**v1 answer (decision D16):** desktop = **in-process timer** while the app runs, plus fire-on-open reconcile for anything missed. Keep the app alive in the tray. Copy is honest: *"Ikoro must be running to remind you on desktop."* OS-native desktop scheduling is backlog (M12), not v1.

### 2.3 Capacitor local-notifications: use the fail-loud flags

Capacitor 8.3.0 added two schedule options that make the exact-alarm promise non-silent:

- `isExactNotification` (boolean, default `true`) — on Android 12+ `schedule()` will **open the "Alarms & reminders" system screen** so the user can grant exact alarms. If they decline, the notification silently degrades to inexact **and** the result carries `warning`.
- `isExactMandatory` (boolean, default `false`) — set **`true`** for Ikoro. Then a denied permission makes the whole `schedule()` call **reject** instead of quietly becoming an inexact alarm.

Always read `ScheduleResult.warning` and persist it; a "successful" schedule with a warning means the promise is broken and the UI must say so.

`checkExactNotificationSetting()` and `changeExactNotificationSetting()` still exist, and revoking the setting **restarts the app and deletes already-scheduled exact notifications** — so re-check on every resume, and `rescheduleAll()` from the local store.

Capacitor is **8.x**, not 7. `SCHEDULE_EXACT_ALARM` still has to be added to `AndroidManifest.xml` by hand.

### 2.4 Drizzle — the server does **not** use Prisma

The user's standing choice across their SvelteKit projects is **Drizzle + Neon + Better Auth + Valibot**, and they corrected the plan on 2026-10-03: *"for the server we should be using drizzle not prisma"*. Install:

```bash
bun add drizzle-orm@0.45.3 @neondatabase/serverless@1.2.0 @better-auth/drizzle-adapter@1.7.7
bun add -d drizzle-kit@0.31.11
```

Details that matter:

- **The Better Auth adapter is its own package now.** Install `@better-auth/drizzle-adapter` and import `drizzleAdapter` from it. `better-auth/adapters/drizzle` is the legacy subpath.
- `drizzleAdapter(db, { provider: 'pg', schema })` — pass the `schema` object so relations resolve.
- A **`relations-v2`** variant exists (`@better-auth/drizzle-adapter/relations-v2`) for Drizzle Relations v2. **Do not use it here** — the schema is hand-authored with `pgTable` and Relations v1 is enough. Switching is not free.
- The driver is `drizzle-orm/neon-http` over `@neondatabase/serverless`. It is HTTP-based, so there is no pool to leak — but also no pipelining or interactive transactions.
- **Schema is hand-authored** with `pgTable` from `drizzle-orm/pg-core`; the Better Auth tables come from `bunx auth@latest generate` and get reconciled into the same file.
- Migrations: `bunx drizzle-kit generate` then `bunx drizzle-kit migrate`.
- **Initialise the client lazily.** Do not read `DATABASE_URL` at module top level — a placeholder or missing value breaks `vite build`. Wrap the client in a lazily-evaluated `Proxy` so build-time module evaluation is inert. (Learned the hard way on the Aghara project.)
- No `prisma.config.ts`, no mandatory generator `output`, no `datasource` block.

**Verify at M10:** that `@better-auth/drizzle-adapter@1.7.7` accepts a `neon-http` instance with the hand-authored schema. Fallbacks, in order: generate the schema with `bunx auth@latest generate`; then try the `relations-v2` adapter.

### 2.5 Better Auth: passkey-first exists, and so do recovery codes

- Passkey-first **registration** is real: `passkey({ registration: { requireSession: false, resolveUser } })` plus `authClient.passkey.addPasskey({ context, createSession: true })`. This closes the plan's open question R9. Users can be created lazily in `registration.afterVerification` so nobody is written to the database before the WebAuthn ceremony succeeds.
- **Recovery codes** come from the `twoFactor` plugin, which by default demands a password — passwordless users need `twoFactor({ allowPasswordless: true })`. Then `twoFactor.generateBackupCodes()` / `verifyBackupCode({ code })` work. Backup codes are one-shot (deleted on use).
- Still to verify at M10: whether `verifyBackupCode` can be called **cold** (no prior 2FA challenge) — i.e. whether it works as a standalone sign-in for a user who has lost their passkey. If it cannot, the documented fallback is **multiple passkeys** (require the user to register a second one) plus a self-hosted DB-level recovery note.

### 2.6 `svelte-idb` — the user's own package, and what it does *not* have yet

Ikoro stores to **`svelte-idb` 0.1.6**, not Dexie (D23). It is Michael's own package (<https://github.com/Michael-Obele/svelte-idb>, docs at <http://idb.svelte-apps.me/>), zero-dependency, runes-native, ~2 KB, MIT, `peerDependencies: svelte ^5`. Install:

```bash
bun add svelte-idb@0.1.6
```

Two entry points, and the split matters for testing:

| Import | Gives |
| ------ | ----- |
| `svelte-idb` | `createDB`, `QueryBuilder`, the `IDB*Error` classes, `isBrowser`, and types. **No runes** — safe to import from a plain Node test. |
| `svelte-idb/svelte` | `createReactiveDB`, `ReactiveStore`, `LiveQuery`. Runes-based; needs a Svelte runtime. |

**Verified surface (read from the published `.d.ts`, 2026-10-03):**

```ts
createDB<TSchema>({ name, version, stores, ssr?, onUpgrade?, onBlocked?, debug? }): Database<TSchema>

StoreConfig  = { keyPath: string; autoIncrement?: boolean; indexes?: Record<string, IndexConfig> }
IndexConfig  = { keyPath: string | string[]; unique?: boolean; multiEntry?: boolean }

IStore<T>    = add · put · get · getAll · getAllFromIndex(index, query?, count?)
               · where(index) · delete · clear · count
IQueryBuilder<T> = equals · between(a, b, lowerOpen?, upperOpen?) · above · aboveOrEqual
               · below · belowOrEqual  →  toArray() · first() · count()

LiveQuery<T> = { current, loading, error, refresh(), destroy() }   // from svelte-idb/svelte
```

**Three gaps that shaped the plan — do not design around them existing:**

1. **There is no transaction API.** `transaction` appears zero times in the published bundle, and it is on the project's own roadmap ("multi-store atomic operations with auto-rollback"). Consequences: (a) cascading deletes are done **idempotently in a fixed order**, not atomically; (b) the sync queue cannot be a separate `outbox` store written alongside the change — see §3.1 for the **dirty-flag** design, which needs no second write at all; (c) deletes are **soft** from day one, so an interrupted delete is recoverable rather than lost.
2. **Live queries are not index-aware.** Only `liveAll()`, `liveGet(key)` and `liveCount()` are reactive; `where(...)` is core-only and explicitly "MVP". So a filtered screen (`/today`, one list) subscribes with `liveAll()` and narrows with `$derived`. That is O(N) per mutation — fine into the low thousands of tasks, and it is the ceiling to state honestly. When reactive indexed queries land upstream, only `stores/view.ts` changes.
3. **`onUpgrade` is a raw hook, not automatic migration sugar.** It hands you `(db, oldVersion, newVersion, transaction)` so you write the upgrade yourself; the roadmap lists "migration sugar" as unfinished. **The plan's answer is to not need it:** the full schema — including the sync-only fields — is declared at `version: 1` in M1, so Phase A never performs an upgrade. If the schema must change, verify on a throwaway profile that data survives before trusting it.

**Version/perception note:** `0.1.6`, last pushed 2026-05-21, one maintainer, 5 open issues. That is exactly why the plan funnels every read and write through `repo.ts` and every subscription through `stores/view.ts` — two files hold the entire library surface, so a 0.x breaking change or an upstream feature landing is a two-file edit.

### 2.7 Other drift worth knowing
- `tailwindcss` v4 has a **CSS-first** config — there is no `tailwind.config.js` by default; theme tokens live in CSS via `@theme`. Don't scaffold a v3 config.
- `vitest` is at **5.x**; the plan's snippets were written against 2/3. The API used here (`describe`/`it`/`expect`, `test.include`) is unchanged.
- `lucide-svelte` is at **1.0.1** — a 1.x release, not 0.x.
- `eslint` is at **10.x**. Let `sv add eslint` pick the version it knows; forcing 10 may break its flat-config preset.
- `bit-ui` (`bits-ui`) is at 2.x — shadcn-svelte may pull a specific minor. Don't pin it by hand; let shadcn-svelte own it.

# M10 — Sync server (auth + changes API + SSE)

**Goal:** the optional, self-hosted backend. Passkey sign-in, a change feed with a monotonic cursor, and a server-sent-events channel. No analytics, no third parties, no Redis.

**Prev:** [M8](./M8-qa-release.md) — Phase A shipped. (M9 is independent; either order works.)
**Next:** [M11 — sync client](./M11-sync-client.md)

**Read first:** [`../design/architecture.md`](../design/architecture.md) §6–§7 · [`../VERSIONS.md`](../VERSIONS.md) §2.4 (Drizzle) and §2.5 (Better Auth) · [`../RESEARCH-2026-10.md`](../RESEARCH-2026-10.md) D19/D20.

> **Two things changed since the plan was written.** The server uses **Drizzle**, not Prisma (user correction 2026-10-03 — see [`VERSIONS.md`](../VERSIONS.md) §2.4), and Better Auth's Drizzle adapter now lives in its own package, `@better-auth/drizzle-adapter`. The auth open questions are answered too: passkey-first registration exists, and recovery codes need `allowPasswordless: true`.

---

## Files

```
packages/sync/src/lib/index.ts          protocol: schemas, ChangeOp, ChangeRow, mergeRow
packages/sync/tests/merge.test.ts
apps/server/package.json                name: "server"
apps/server/drizzle.config.ts           drizzle-kit: schema path, dialect, migrations dir
apps/server/src/lib/db/schema.ts        the whole schema — hand-authored pgTable definitions
apps/server/src/lib/db/client.ts        lazy Drizzle client over neon-http
apps/server/src/lib/auth.ts             betterAuth() instance
apps/server/src/hooks.server.ts          Bearer session guard
apps/server/src/routes/api/auth/[...all]/+server.ts
apps/server/src/routes/api/v1/changes/+server.ts
apps/server/src/routes/api/v1/stream/+server.ts
apps/server/src/routes/api/v1/health/+server.ts
apps/server/.env.example
apps/server/tests/merge.test.ts
```

---

## Step 1 — `packages/sync` first (pure logic, fully testable)

Write `packages/sync/tests/merge.test.ts` first:

- [ ] Newer local `updatedAt` wins.
- [ ] Newer remote `updatedAt` wins.
- [ ] **Equal `updatedAt` → the server wins** (the documented tie-break).
- [ ] A remote tombstone (`deletedAt` set) deletes the local row.
- [ ] Device-scoped fields (`alarmId`, `alarmFiredAt`) are **never** taken from the remote row.
- [ ] `mergeRow(undefined, remote)` returns the remote row unchanged.
- [ ] Malformed payloads fail validation with a field path, not a thrown string.

Then implement `packages/sync/src/lib/index.ts` with the contracts from [`00-conventions.md`](./00-conventions.md) §3.3, plus the Valibot schemas for each payload kind.

```bash
bun run --filter '@ikoro/sync' test
```

- [ ] Green. This package has no dependencies on `svelte-idb`, Svelte, or Drizzle — keep it that way.

## Step 2 — scaffold `apps/server`

```bash
rm -rf apps/server
bunx sv create apps/server --template minimal --types ts
bun run scaffold
bun install
```

- [ ] Name it `server` in `package.json` (the root filters depend on it).
- [ ] `adapter-node`, **no UI** — delete the demo route and leave a 404 page.
- [ ] Add `"@ikoro/sync": "workspace:*"`.

## Step 3 — Drizzle ORM + Neon

```bash
cd apps/server
bun add drizzle-orm@0.45.3 @neondatabase/serverless@1.2.0 @better-auth/drizzle-adapter@1.7.7
bun add -d drizzle-kit@0.31.11
```

- [ ] `drizzle.config.ts` at the workspace root: `dialect: 'postgresql'`, `schema: './src/lib/db/schema.ts'`, `out: './drizzle'`. Read `DATABASE_URL` from the environment, never inline it.
- [ ] `src/lib/db/schema.ts` — the whole schema, hand-authored with `pgTable` from `drizzle-orm/pg-core`:
  - Better Auth: `user`, `session`, `account`, `verification`, `passkey`, plus whatever `twoFactor` needs for backup codes. Get the authoritative version from `bunx auth@latest generate` and reconcile it into this file — do not type table and column names from memory, because the drizzle adapter matches them literally.
  - App: `list`, `task` — `id` (uuid, **client-generated** primary key), `userId`, the payload columns, `updatedAt` (the client LWW clock), `rev` (bigserial, the monotonic cursor), `deletedAt` (tombstone).
  - Indexes: one on `(userId, rev)` for each of `list` and `task`. The change feed queries exactly that.
- [ ] `src/lib/db/client.ts` — **initialise lazily.** Do not construct the client at module top level from `process.env.DATABASE_URL`: a placeholder or missing value breaks `vite build`. A lazily-evaluated `Proxy` keeps build-time module evaluation inert.

  ```ts
  import { neon } from '@neondatabase/serverless';
  import { drizzle } from 'drizzle-orm/neon-http';
  import * as schema from './schema';

  const create = () => drizzle(neon(process.env.DATABASE_URL!), { schema });
  let instance: ReturnType<typeof create> | undefined;

  /** Deferred so importing this module never requires DATABASE_URL to exist. */
  export const db = new Proxy({} as ReturnType<typeof create>, {
    get: (_target, prop) => ((instance ??= create()) as never)[prop as never],
  });
  ```

- [ ] `bunx drizzle-kit generate`, **read the generated SQL**, then `bunx drizzle-kit migrate`.

> ⚠️ **Ask the user for a Neon `DATABASE_URL` before this step.** They must supply it or create the Neon project; do not invent a connection string and do not create accounts for them. Use a **dev branch** for migration work. Write `apps/server/.env.example` with the variable names and no values.

## Step 4 — Better Auth

```bash
bun add better-auth@1.7.7 @better-auth/passkey@1.7.7
```

- [ ] `src/lib/auth.ts`:
  - `passkey()` with **passkey-first registration**: `registration: { requireSession: false, resolveUser }`. Create the user inside `registration.afterVerification` — never before the WebAuthn ceremony succeeds, or a failed ceremony leaves an orphan row.
  - `twoFactor({ allowPasswordless: true })` — required for passwordless users to obtain recovery codes.
  - The **`bearer`** plugin, so the app can authenticate with a token instead of a cookie. This matters: the app runs in a WebView (`capacitor://localhost` / `https://localhost`) and cross-origin cookies are hostile there. Session tokens go in the client's secure storage.
  - `trustedOrigins` including the app's WebView origins and the landing origin.
  - `secret` from `BETTER_AUTH_SECRET`.
- [ ] Generate the schema with the CLI (`bunx auth@latest generate`) and reconcile it into `src/lib/db/schema.ts` — one source of truth, not two. The CLI's output is authoritative for table and column names.
- [ ] Handler at `src/routes/api/auth/[...all]/+server.ts` delegating to `auth.handler(request)`.
- [ ] Sign-out must invalidate the token server-side.

## Step 5 — the `/api/v1` surface

All three routes are `+server.ts`, Bearer-guarded (except health), and validate bodies with `@ikoro/sync` schemas.

**`GET /api/v1/changes?since=<rev>&limit=500`**

- [ ] Returns every row for the user with `rev > since`, ascending, capped at `limit` (default 500, hard max 500) — **including tombstones**.
- [ ] Response `{ changes, nextRev }` where `nextRev` is the highest `rev` returned (or `since` when nothing changed).
- [ ] Never let `userId` come from the request — it comes from the session. A client-supplied `userId` is an IDOR.

**`POST /api/v1/changes`**

- [ ] Body `{ ops: ChangeOp[] }`; validate each op; apply per-record LWW (`op.updatedAt > row.updatedAt`); reject a stale op and report it rather than silently dropping it.
- [ ] Return `{ applied, rev }`.
- [ ] Idempotent by `op.id`: replaying the same batch must not double-apply.
- [ ] Bound the batch size and reject oversized bodies.

**`GET /api/v1/stream`** — SSE

- [ ] An in-memory `Map<userId, Set<controller>>`. On an applied push, emit `{ rev }` to that user's connections.
- [ ] Keepalive comment every **25 s** so intermediaries do not reap the connection.
- [ ] `hello` on connect.
- [ ] Clean up the subscriber on abort — a leaked controller per reconnect is a slow memory leak on a 512 MB instance.
- [ ] **No Redis.** Single instance; see D13.

**`GET /api/v1/health`**

- [ ] No auth. `{ status: 'ok', rev }`. Used by the health-check playbook and the deploy smoke test.

- [ ] Naive in-memory per-IP rate limit on `/api/v1/*`. Document it as per-instance, not a defence against a distributed flood.

```bash
bun run --filter server test
```

- [ ] Route validation and the LWW path are covered with a mocked Drizzle client. Do not point tests at a real database.

## Step 6 — deploy ⚠️

- [ ] **Ask the user before deploying.** They own the Fly.io account and the domain — and the account already exists (confirmed 2026-10-03).
- [ ] `fly launch --no-deploy` to generate `fly.toml`. A Dockerfile installs with Bun and runs `adapter-node`'s `build/index.js`.
- [ ] Secrets: `fly secrets set DATABASE_URL=… BETTER_AUTH_SECRET=… APP_ORIGIN=…`. Never inline them in `fly.toml`.
- [ ] **One always-on machine, `auto_stop_machines = false`.** SSE holds a long-lived subscriber connection per client; scale-to-zero would drop every stream and break live updates. This is the one Fly.io setting that matters here.
- [ ] Smoke test: `curl https://<app>.fly.dev/api/v1/health` returns `{"status":"ok",…}`.

## Step 7 — verify and commit

```bash
cd ../.. && bun run check && bun run test
git add -A
git commit -m "feat: sync server — Better Auth passkeys, changes API, SSE (M10)"
```

---

## Acceptance

- [ ] `packages/sync` has zero app/server dependencies and its merge tests pass.
- [ ] **No Prisma anywhere.** The data layer is `drizzle-orm` + `drizzle-kit` + `@neondatabase/serverless`, with Better Auth wired through `@better-auth/drizzle-adapter`.
- [ ] The DB client is constructed lazily, so `vite build` succeeds with no `DATABASE_URL` present.
- [ ] A user can register with a passkey and sign in with it — no password is ever created.
- [ ] A second passkey can be added to the same account, and a recovery code can be generated (and a user without a passkey can use one — **verify this cold**, see RESEARCH §4 item 3; if it does not work, document the limitation and require ≥ 2 passkeys).
- [ ] `rev` is monotonic across the user's rows; `GET /changes` returns tombstones.
- [ ] SSE delivers a change signal to a second connection when a push lands.
- [ ] Every `/api/v1` route except health rejects an unauthenticated request.
- [ ] No route takes a `userId` from the request.
- [ ] Nothing was deployed without explicit approval.

## Findings

_(Record: Prisma generator provider used · whether Better Auth's adapter accepted it · whether `verifyBackupCode` works cold · the SSE keepalive interval actually observed.)_

---

> **Prompt for the builder**
>
_"Execute M10 of the Ikoro build plan. Read `docs/build/M10-server.md`, `docs/VERSIONS.md` §2.4–2.5 and `docs/build/00-conventions.md` §3.3 first. The server uses Drizzle, not Prisma: `drizzle-orm` + `drizzle-kit` + `@neondatabase/serverless`, with Better Auth wired through `@better-auth/drizzle-adapter`. Initialise the DB client lazily — a top-level `process.env.DATABASE_URL` read will break `vite build`. Ask me for the Neon DATABASE_URL; do not invent one. Better Auth needs the bearer plugin because the app runs in a WebView. Write `packages/sync/tests/merge.test.ts` first. Ask before deploying or running any migration against a non-local database."_

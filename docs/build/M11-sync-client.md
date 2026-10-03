# M11 — Sync client (dirty-flag queue + pull/push + live updates)

**Goal:** two signed-in devices converge deterministically, without losing data — and with sync **off** the app makes zero network calls.

**Prev:** [M10](./M10-server.md) — server deployed and its health check green.
**Next:** nothing. This is the last milestone in scope.

**Read first:** [`00-conventions.md`](./00-conventions.md) §3.1 and §3.3 · [`../VERSIONS.md`](../VERSIONS.md) §2.6 · [`../RESEARCH-2026-10.md`](../RESEARCH-2026-10.md) F14 / D23 · [`../design/architecture.md`](../design/architecture.md) §6.

---

## ⚠️ The original design does not survive `svelte-idb`. Read this first.

The plan used to say: *"every local write enqueues an op in the same Dexie transaction as the write itself."* That is impossible — **svelte-idb has no transaction API at all.** A write and a separate queue entry are two independent operations, so either can be the one that survives a crash. A second store would mean a queue that silently disagrees with reality.

**The replacement: the queue *is* the data.** Each record already carries `dirty: 0 | 1` and an index on it. So:

| Old design | This design |
| ---------- | ----------- |
| Mutation writes the row, then inserts into an `outbox` store | Mutation writes the row **once**, with `dirty: 1` |
| "What needs pushing?" = query the outbox | `where('byDirty').equals(1)` on `tasks` and `lists` |
| Crash between the two writes = an unpushed change nobody knows about | Impossible — there is only one write |
| Ack deletes the outbox row | Ack `put()`s the row back with `dirty: 0` |
| **Needed** Dexie `version(2)` to add the outbox table | **No schema change** — `dirty` was declared in M1 |

**Why retrying is safe, which is the real load-bearing idea:** an op carries the row's `updatedAt` and the server applies last-write-wins. So pushing the same row twice is a no-op the second time. If the ack `put()` fails after a successful POST, the row stays dirty and gets pushed again — harmless. **Idempotent retry is what replaces the transaction.** Nothing here needs atomicity.

There is **no `version(2)`** in this milestone. If you find yourself bumping the schema version, you have taken a wrong turn.

---

## Files

```
apps/app/src/lib/sync/queue.ts         dirty rows → ChangeOp[]; markAllDirty(); ack()
apps/app/src/lib/sync/client.ts        push() + pull() + the cursor
apps/app/src/lib/sync/stream.ts        EventSource wrapper
apps/app/src/lib/sync/auth-client.ts   Better Auth client (bearer token)
apps/app/src/lib/sync/payload.ts       toSyncedPayload / applyRemoteRow — the field split
apps/app/src/routes/settings/Account.svelte
apps/app/src/lib/db/repo.ts            ← MODIFIED: nothing, if M1 was followed (dirty is already set)
apps/app/tests/sync.test.ts
apps/app/tests/payload.test.ts
```

---

## The rules

1. **Storage stays the source of truth.** The app is fully usable offline, forever.
2. **Sync is off by default.** Until the user signs in, the app performs **zero** network requests. This is a product promise, not an optimisation.
3. **One write per mutation.** Never write a record and then a separate "queue" record.
4. **One merge implementation**, in `@ikoro/sync`. The client must not contain a second copy of the LWW rule.
5. **Device-scoped fields never cross the wire** — and must survive a pull that overwrites everything else.
6. **After any pull that moved an `alarmAt`, call `rescheduleAll()`.**

---

## Step 1 — the meta store (already in the v1 schema)

The cursor and flags need somewhere to live. `meta` is declared in [`00-conventions.md`](./00-conventions.md) §3.1's `stores`, so **nothing migrates here**:

```ts
// one row per key
interface MetaRow { key: string; value: unknown; updatedAt: string }
```

Keys: `'syncEnabled'`, `'syncCursor'`, `'lastSyncedAt'`.

- [ ] `repo.getMeta<T>(key, fallback)`, `repo.setMeta(key, value)`, `repo.deleteMeta(key)` — thin wrappers, in `repo.ts`, so the meta store is not touched from anywhere else.

## Step 2 — write the failing tests

`apps/app/tests/payload.test.ts` (pure, node):

- [ ] `toSyncedPayload(task)` **excludes** `alarmId`, `alarmFiredAt`, `dirty`, `rev`.
- [ ] `toSyncedPayload(task)` **includes** `dueTime`, `priority`, `repeat`, `alarmAt`, `deletedAt` — the fields Google's API cannot carry, which is exactly why we run our own server.
- [ ] `applyRemoteRow(local, remote)` keeps the local `alarmId` and `alarmFiredAt` while taking every other field from `remote`.
- [ ] A remote tombstone (`deletedAt` set) results in a row that every repo read excludes.

`apps/app/tests/sync.test.ts` (`import 'fake-indexeddb/auto'` first, mocked `fetch`):

- [ ] With no session, `push()` and `pull()` perform **no fetch at all** — assert the mock was never called.
- [ ] A repo write leaves the row `dirty: 1`; it appears in `queue.pending()`.
- [ ] `push()` success → the pushed rows are `dirty: 0` and carry the `rev` the server returned.
- [ ] `push()` network failure → rows stay `dirty: 1`, `attempts`/backoff state advances, nothing is lost.
- [ ] **Re-pushing a row already accepted is harmless** — the second push is accepted and does not corrupt the row (this is the idempotency property the whole design rests on).
- [ ] A **stale op** rejected by the server → the local row is replaced by the server's newer row, and the row is no longer dirty.
- [ ] A pull bringing a **server-newer** task replaces it but **preserves** `alarmId` and `alarmFiredAt`.
- [ ] A pull that changes `alarmAt` on an armed task calls `rescheduleAll()` exactly once.
- [ ] A pull containing a **tombstone** makes the row disappear from `tasksByList`.
- [ ] Applying the same `ChangeRow` twice is a no-op (idempotent).
- [ ] `markAllDirty()` marks every list and task dirty — the path used when sync is first enabled, so pre-existing local data is pushed exactly once.
- [ ] The cursor advances to `nextRev` and survives a reload (`meta`), and a pull with `since=cursor` sends the right query string.

```bash
cd apps/app && bun run test
```

- [ ] Fails for the right reason first.

## Step 3 — implement `payload.ts` and `queue.ts`

- [ ] `payload.ts` — the field split, in one place, tested above. Both push and pull go through it.
- [ ] `queue.ts`:
  - `pending()` → `db.tasks.where('byDirty').equals(1).toArray()` plus the same for `lists`.
  - `toOps(rows)` → `ChangeOp[]` using `toSyncedPayload`.
  - `markAllDirty()` → `put()` every row with `dirty: 1`. Batch in pages so a large library does not build one giant array.
  - `ack(ops, revByEntityId)` → one `put()` per row with `dirty: 0` and the new `rev`.

## Step 4 — implement `client.ts`

- [ ] `push()` — read `pending()`, cap a batch at **200 ops**, POST `/api/v1/changes`, then `ack()`. On failure, back off exponentially (cap ~5 min) and record the error for the settings UI.
- [ ] `pull()` — `GET /api/v1/changes?since=<cursor>&limit=500`, loop until `nextRev === since`, merge each row with `mergeRow` from `@ikoro/sync` and `applyRemoteRow`, then persist the cursor.
- [ ] `sync()` — push, then pull, then `rescheduleAll()` **if any pulled row changed `alarmAt`**.
- [ ] Triggers: launch, resume (`appStateChange` / window focus), the browser `online` event, and an SSE signal.
- [ ] **Serialise.** One in-flight `sync()` promise; a second caller awaits the first rather than starting a parallel run.
- [ ] Never construct the sync client at module load — sync must remain inert (and offline) until enabled.

## Step 5 — `stream.ts`

- [ ] `EventSource` against `/api/v1/stream` with the bearer token.
- [ ] A `change` event triggers a **debounced** (500 ms) pull — the server deliberately sends only `{ rev }`.
- [ ] Reconnect with backoff; stop cleanly on sign-out.
- [ ] Expose `synced | syncing | offline` for the settings UI.

## Step 6 — the account screen

`Account.svelte`:

- [ ] **Sync off** by default, with a one-line explanation and a sign-in button.
- [ ] Sign in / create account **with a passkey** (WebAuthn). The ceremony needs a secure context — on Android the WebView origin must count as trustworthy; **verify on device and record the result**.
- [ ] On registration: prompt to **add a second passkey**, then show recovery codes **once**, with a download button. Say plainly that losing every passkey without a recovery code means losing the account.
- [ ] **First time sync is enabled → `markAllDirty()`**, so everything already on the device is pushed exactly once.
- [ ] Sign out → stop the stream, clear the token, **keep local data**, stop pushing. Never delete anything.
- [ ] Status line: `Synced · 2 min ago` / `Syncing…` / `Offline · will retry`.
- [ ] Token storage: `@capacitor/preferences` on native, `localStorage` on web. Never in a URL.

## Step 7 — end-to-end, on real devices

Against the deployed server, with two devices (or one device + one browser):

- [ ] Phone creates a task → the desktop updates **live** (SSE), not on next open.
- [ ] Both devices edit offline → reconnect → they converge.
- [ ] The **same field** edited on both sides → the later `updatedAt` wins on both devices, consistently. Run it with the clocks on either side of the tie to prove the tie-break.
- [ ] Delete on one device → the row disappears on the other (tombstone).
- [ ] **Kill the app mid-push** (or simulate with a mocked failure), reopen → the change is still pushed. *This is the property the dirty-flag design exists for; test it deliberately, not incidentally.*
- [ ] With sync off, the app makes no requests — verify in the network panel across a restart.
- [ ] An alarm set on the device that owns it still fires after a pull changed other tasks.
- [ ] Sign out → local data intact, no further requests.

## Step 8 — verify and commit

```bash
cd ../.. && bun run check && bun run test
```

- [ ] No schema version bump: `grep -rn "version:" apps/app/src/lib/db/schema.ts` still reports `1`.
- [ ] No outbox store, and no second write path: `grep -rn "outbox" apps/app/src` → no results.
- [ ] `mergeRow` is imported from `@ikoro/sync`, never reimplemented.

```bash
git add -A
git commit -m "feat: sync client — dirty-flag queue, LWW merge, SSE live updates (M11)"
```

---

## Acceptance

- [ ] Two signed-in devices converge, and the same conflict resolves identically on both.
- [ ] No data loss on conflict: a rejected op leaves the newer server row in place, and device-scoped fields survive a pull.
- [ ] Deleting propagates via tombstones.
- [ ] Live updates arrive over SSE without a manual refresh.
- [ ] **Sync disabled ⇒ zero network calls.** Verified, not assumed.
- [ ] **A change survives a crash mid-push** and is delivered on the next attempt.
- [ ] `markAllDirty()` runs once when sync is first enabled, so pre-existing local data reaches the server.
- [ ] `mergeRow` has exactly one implementation.
- [ ] A failed push retries with backoff and is visible in the UI; it is never silently dropped.
- [ ] `rescheduleAll()` runs after a pull that moved an `alarmAt`.
- [ ] **No schema migration was needed** — `version` is still `1`.

## Findings

_(Record: did the WebAuthn ceremony work inside the Android WebView · observed SSE latency · the conflict tie-break result · whether `fake-indexeddb` faithfully reproduced the `byDirty` index behaviour.)_

---

> **Prompt for the builder**
>
> _«Execute M11 of the Ikoro build plan. Read the ⚠️ box at the top of `docs/build/M11-sync-client.md` first: `svelte-idb` has no transactions, so the sync queue is the `dirty` flag on each record — there is no `outbox` store and there must be no schema version bump. Idempotent retry is what replaces atomicity; re-pushing an already-accepted row must be harmless. The merge rule exists only in `@ikoro/sync` — do not reimplement it. Sync must be off by default with zero network calls until sign-in, and `markAllDirty()` must run when it is first enabled. Write `tests/payload.test.ts` and `tests/sync.test.ts` with a mocked fetch and `import 'fake-indexeddb/auto'` first, and confirm they fail for the right reason before implementing. Ask before deploying or starting any server.»_

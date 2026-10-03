# M11 — Sync client (outbox + pull/push + live updates)

**Goal:** two signed-in devices converge, deterministically, without losing data — and with sync **off** the app makes zero network calls.

**Prev:** [M10](./M10-server.md) — server deployed and its health check green.
**Next:** nothing. This is the last milestone in scope.

**Read first:** [`../design/architecture.md`](../design/architecture.md) §6 · [`00-conventions.md`](./00-conventions.md) §3.1 (the sync fields already exist) and §3.3 (the wire contract).

---

## Files

```
apps/app/src/lib/sync/outbox.ts        the durable queue
apps/app/src/lib/sync/client.ts        flush + pull + merge
apps/app/src/lib/sync/stream.ts        EventSource wrapper
apps/app/src/lib/sync/auth-client.ts   Better Auth client (bearer token)
apps/app/src/routes/settings/Account.svelte
apps/app/src/lib/db/schema.ts          ← MODIFIED: version(2) adds the outbox table
apps/app/src/lib/db/repo.ts            ← MODIFIED: writes enqueue an op
apps/app/src/lib/alarms/reconcile.ts   ← IMPORTED: rescheduleAll() after a pull
apps/app/tests/sync.test.ts
```

---

## The rules

1. **Dexie stays the source of truth.** The network is a background detail. The app must be fully usable offline, forever.
2. **Sync is off by default.** Until the user signs in, the app performs **zero** network requests. This is a product promise, not a performance nicety.
3. **Every local write enqueues an op** in the same Dexie transaction as the write itself. A write that succeeds but fails to enqueue is data the server will never learn about.
4. **One merge implementation.** It lives in `@ikoro/sync`. The client must not contain a second copy of the LWW rule.
5. **Device-scoped fields never cross the wire.** `alarmId` and `alarmFiredAt` stay local; after any pull that changed `alarmAt`, call `rescheduleAll()`.

---

## Step 1 — schema migration

`apps/app/src/lib/db/schema.ts`:

```ts
this.version(2).stores({
  lists: 'id, sortOrder, updatedAt',
  tasks: 'id, listId, completedAt, dueDate, alarmAt, updatedAt, parentId',
  outbox: '++seq, entityId, at',   // seq = monotonic local ordering
});
```

- [ ] Add the `OutboxEntry` interface: `{ seq?, id, kind, entityId, op, payload, at, tries, lastError? }`.
- [ ] **Never edit `version(1)`.** Add `version(2)` beside it. Editing an applied version silently corrupts existing installs.
- [ ] `db.outbox!: Table<OutboxEntry, number>` on the class.

## Step 2 — write the failing tests

`apps/app/tests/sync.test.ts` (`import 'fake-indexeddb/auto'` first, mock `fetch`):

- [ ] A repo write (`createTask`, `updateTask`, `toggleTask`, `deleteTask`) enqueues exactly one op, inside the same transaction.
- [ ] `flush()` success → those outbox rows are deleted and the cursor advances.
- [ ] `flush()` network failure → rows remain, `tries` increments, and a backoff delay is recorded.
- [ ] A **stale op** rejected by the server → the local row is replaced by the server's newer row, and the outbox entry is dropped (not retried forever).
- [ ] A pull that brings a **server-newer** version of a task replaces the local row but **preserves** the local `alarmId` and `alarmFiredAt`.
- [ ] A pull that changes `alarmAt` on an armed task triggers `rescheduleAll()` exactly once.
- [ ] A pull containing a **tombstone** deletes the local row.
- [ ] Replaying the same `ChangeRow` twice is a no-op (idempotent).
- [ ] With no session, `client.ts` performs **no fetch at all** — assert the mock was never called.

```bash
cd apps/app && bun run test
```

- [ ] Fails for the right reason first.

## Step 3 — implement the queue

`outbox.ts`:

- [ ] `enqueue(entry)` — called from inside `repo.ts` writes, in the same transaction.
- [ ] `pending(limit)` — oldest-first by `seq`.
- [ ] `markDone(seqs)` / `markFailed(seq, error)`.
- [ ] `outboxCount()` — for the settings badge.

`repo.ts` changes:

- [ ] Each mutating function wraps its Dexie write **and** the `enqueue` in one `db.transaction('rw', db.tasks, db.outbox, …)`.
- [ ] When sync is disabled, `enqueue` is a no-op — the outbox must not grow unbounded for a user who never signs in. Guard on a single `syncEnabled()` predicate, not on a scattered check.

## Step 4 — implement the client

`client.ts`:

- [ ] `flush()` — batched POST of `pending()`; on success clear; on failure back off exponentially (cap ~5 min) and record `lastError`.
- [ ] `pull()` — `GET /changes?since=<cursor>&limit=500`, loop until `nextRev === since`, merge each row through `mergeRow` from `@ikoro/sync`, persist the cursor.
- [ ] `sync()` — flush, then pull, then `rescheduleAll()` if any `alarmAt` changed.
- [ ] Triggers: app launch, app resume (`appStateChange` / window focus), the browser `online` event, and an SSE signal.
- [ ] Cursor and sync-enabled flag persist locally. Losing the cursor costs a full re-pull, not data — but do not lose it casually.
- [ ] A pull and a flush must never run concurrently; serialise with a single in-flight promise.

`stream.ts`:

- [ ] `EventSource` against `/api/v1/stream` with the bearer token.
- [ ] A `change` event triggers a **debounced** pull (500 ms) — the server sends only `{ rev }`, by design; the client refetches.
- [ ] Reconnect with backoff on error; stop cleanly on sign-out.
- [ ] Connection state exposed as `synced | syncing | offline` for the settings UI.

## Step 5 — the account screen

`Account.svelte` in settings:

- [ ] **Sync off** by default, with a clear one-line explanation and a sign-in button.
- [ ] Sign in / create account **with a passkey** (WebAuthn). The passkey ceremony needs a secure context — on Android the WebView origin must be treated as trustworthy; **verify on device** and record the result.
- [ ] After registration: prompt to **add a second passkey**, and show recovery codes **once**, with a download button. State plainly that losing every passkey without a recovery code means losing the account.
- [ ] Sign out → stop the stream, clear the token, **keep local data**, stop enqueuing, and never delete anything.
- [ ] Status line: `Synced · 2 min ago` / `Syncing…` / `Offline · will retry`.
- [ ] Token storage: `@capacitor/preferences` on native, in-memory + `localStorage` on web. Do not put a token in a URL.

## Step 6 — end-to-end, on real devices

Against the deployed server, with two devices (or one device + one browser):

- [ ] Phone creates a task → the desktop updates **live** (SSE), not on next open.
- [ ] Both devices edit while offline → reconnect → they converge to the same state.
- [ ] The **same field** edited on both → the later `updatedAt` wins on both devices, consistently. Run it twice with the clocks on either side of the tie to prove the tie-break.
- [ ] Delete a task on one device → it disappears on the other.
- [ ] With sync off, the app performs no network requests — verify in the devtools network panel with the app restarted.
- [ ] An alarm set on the device that owns it still fires **after** a pull changed other tasks.
- [ ] Sign out → local data intact, no further requests.

## Step 7 — verify and commit

```bash
cd ../.. && bun run check && bun run test
git add -A
git commit -m "feat: sync client — outbox, LWW merge, SSE live updates (M11)"
```

---

## Acceptance

- [ ] Two signed-in devices converge, deterministically, and the same conflict resolves the same way on both.
- [ ] No data loss on conflict: a rejected op leaves the newer server row in place, and device-scoped fields survive a pull.
- [ ] Deleting propagates via tombstones.
- [ ] Live updates arrive over SSE without a manual refresh.
- [ ] **Sync disabled ⇒ zero network calls.** Verified, not assumed.
- [ ] `mergeRow` has exactly one implementation, imported from `@ikoro/sync`.
- [ ] A failed flush retries with backoff and is visible in the UI; it is never silently dropped.
- [ ] `rescheduleAll()` runs after a pull that moved an `alarmAt`.

## Findings

_(Record: did the WebAuthn ceremony work inside the Android WebView · the observed SSE latency · the conflict tie-break result.)_

---

> **Prompt for the builder**
>
> _«Execute M11 of the Ikoro build plan. Read `docs/build/M11-sync-client.md` and `docs/build/00-conventions.md` §3.1/§3.3 first. The merge rule exists only in `@ikoro/sync` — do not reimplement it in the client. Sync must be off by default with zero network calls until sign-in. Add Dexie `version(2)`; never edit `version(1)`. Write `tests/sync.test.ts` with a mocked fetch and `import 'fake-indexeddb/auto'` first, and confirm it fails for the right reason before implementing. Ask before deploying or starting any server.»_

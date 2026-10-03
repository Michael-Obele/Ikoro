# M2 — Lists and task CRUD UI

**Goal:** the app is usable. Create a list, add a task, tick it, edit it, delete it, drag to reorder — all of it surviving a reload, all of it through `repo.ts`.

**Prev:** [M1](./M1-data-layer.md) — data layer green and committed.
**Next:** [M3 — views](./M3-views.md)

---

## Files

```
apps/app/src/routes/+layout.svelte                     shell: nav + sidebar
apps/app/src/routes/lists/[id]/+page.svelte            one list view
apps/app/src/lib/components/lists/ListSidebar.svelte
apps/app/src/lib/components/lists/ListDialog.svelte
apps/app/src/lib/components/task/TaskRow.svelte
apps/app/src/lib/components/task/TaskSheet.svelte
apps/app/src/lib/components/task/DuePicker.svelte
apps/app/src/lib/components/task/PriorityPicker.svelte
apps/app/src/lib/stores/view.ts                        reactive read models
apps/app/tests/task-row.test.ts
```

---

## Rules for this milestone

- **Routes never import `svelte-idb`.** Every read goes through `repo.ts`, and every live view goes through `stores/view.ts` (§ below). Components consume those accessors and nothing else.
- **Remote `form` before `command`:** the inline "add task" input is a `<form>` (it has an input); checkbox toggles and dialog confirms are input-less and may use `command`.
- **runed before hand-rolling.** Debouncing the notes autosave, persisting the sidebar's collapsed state, element size — check runed first.
- Inputs need `name` attributes; submitting reads `FormData` from the DOM.

## Reactive read models (`stores/view.ts`)

`svelte-idb/svelte` is reactive, but only for `liveAll()`, `liveGet(key)` and `liveCount()`. **Indexed queries are not reactive** ([`../VERSIONS.md`](../VERSIONS.md) §2.6), so a filtered screen subscribes to the whole store and narrows with `$derived`. Keep that decision in one file so it can be revisited in one file:

```ts
// apps/app/src/lib/stores/view.ts
import { db, type Task, type TaskList } from '$lib/db/schema';

// One subscription per store, for the app's lifetime — there is exactly one
// database instance, so one live query per store is enough.
export const lists = db.lists.liveAll();
export const tasks = db.tasks.liveAll();

// Indexed queries are NOT reactive upstream, so filtering happens here in
// plain code. Call these inside a $derived or a template expression; reading
// `.current` is what registers the reactive dependency.
export const liveLists = (): TaskList[] =>
	lists.current.filter((l) => l.deletedAt === null).sort((a, b) => a.sortOrder - b.sortOrder);

export const liveTasksByList = (listId: string): Task[] =>
	tasks.current
		.filter((t) => t.deletedAt === null && t.listId === listId && t.completedAt === null)
		.sort((a, b) => a.sortOrder - b.sortOrder);
```

That is O(n) per mutation. It is fine into the low thousands of tasks, and it is the honest ceiling of this approach — see [`../VERSIONS.md`](../VERSIONS.md) §2.6.

- [ ] A single `stores/view.ts`, used by every consumer. Do not create `liveAll()` subscriptions inside components — a component that mounts and unmounts would leak one per mount.

---

## Steps

### Step 1 — layout + sidebar

- [ ] `+layout.svelte`: a responsive shell — sidebar on the left (a shadcn `Sheet` on narrow screens), content on the right. Keep the `{@render children()}` call and the dev-gated sv-agentation mount from M0.
- [ ] `ListSidebar.svelte`: renders `lists()`; each row navigates to `/lists/[id]`; active row derives from `$app/state` (Kit 3 — `$app/stores` is gone). Static links to `/today`, `/upcoming`, `/done` (routes arrive in M3 — they may 404 until then, which is fine).
- [ ] Create / rename / delete via `ListDialog.svelte` (shadcn `Dialog`): create calls `repo.createList(name)`, rename calls `repo.renameList`, delete calls `repo.deleteList` **behind a confirmation** — it cascades to tasks and is irreversible.
- [ ] The "add list" and rename forms are `<form>` submits; delete-confirm is a `command`.

### Step 2 — the list view

- [ ] `lists/[id]/+page.svelte`: resolve the id from the route params, render the list name, render `tasksByList(id)`.
- [ ] Inline add-task `<form>` at the top: an input named `title`; submit → `repo.createTask({ listId, title })`; clear and refocus the input on success.
- [ ] `TaskRow.svelte`: shadcn `Checkbox` on the left → `repo.toggleTask(id)`; the title is a button that opens `TaskSheet`; completed rows render struck-through with reduced emphasis.
- [ ] Reorder: `bun add svelte-dnd-action`, drag within a list, on drop call `repo.updateTask(id, { sortOrder })` for each moved row. **One `put()` per row, sequentially — there is no transaction to wrap them in** ([`../VERSIONS.md`](../VERSIONS.md) §2.6). Reordering is idempotent, so a partial apply is re-runnable.
- [ ] Unknown list id → render an empty state with a link back to `/today`. Do not throw.

### Step 3 — the task sheet

- [ ] `TaskSheet.svelte` (shadcn `Sheet`): title input, notes `textarea` with a **400 ms debounced** autosave via `repo.updateTask`, `DuePicker`, `PriorityPicker`, and a delete button behind a confirm.
- [ ] `DuePicker.svelte`: a date input (`YYYY-MM-DD`) plus an optional time input (`HH:mm`). Clearing the date clears the time. Writes `dueDate` / `dueTime` — never a combined datetime.
- [ ] `PriorityPicker.svelte`: four states — none (0), low (1), medium (2), high (3) — as a segmented control or badge group.
- [ ] Autosave must not fire a write for a value the user did not change.

> The "Remind me" control belongs to **M4**, not here. Leave the sheet's layout ready for it; do not add alarm fields yet.

### Step 4 — component test

`apps/app/tests/task-row.test.ts` with `// @vitest-environment jsdom` at the top:

- [ ] Render `TaskRow` from a fixture; click the checkbox; assert the toggle handler was called exactly once with the task id (mock `repo`).
- [ ] Clicking the title opens the sheet (assert the callback fired).

```bash
cd apps/app && bun run test
```

- [ ] New tests pass; the M1 suites still pass.

### Step 5 — verify and commit

```bash
cd ../.. && bun run check && bun run test
```

- [ ] No `svelte-idb` import outside `src/lib/db/`:
      `grep -rn "svelte-idb" apps/app/src --include=*.svelte` → no results.
- [ ] No `@capacitor/*` or `@tauri-apps/*` import anywhere yet.

```bash
git add -A
git commit -m "feat: lists + task CRUD UI (M2)"
```

---

## Acceptance

- [ ] Create list → add task → tick → untick → edit title/notes/due/priority → delete task. All persist across a reload.
- [ ] Reordering lists and tasks persists.
- [ ] Deleting a list deletes its tasks and navigates away from the deleted list's route.
- [ ] No component imports `svelte-idb` or a notification API — components read `stores/view.ts` and write `repo.ts`, nothing else.
- [ ] Add-task and rename use `<form>`; the checkbox and delete-confirm do not.

## Findings

_(Append here if reality disagrees.)_

---

> **Prompt for the builder**
>
> _«Execute M2 of the Ikoro build plan. Read `docs/build/M2-crud-ui.md`, `docs/HANDOVER.md` §2.5, and `docs/build/00-conventions.md` §3.1 first. Storage is `svelte-idb` — routes and components must never import it; reads go through `repo.ts` and live subscriptions through `stores/view.ts`. Indexed queries are not reactive, so filtered views use `liveAll()` plus `$derived`. There are no transactions: one `put()` per record. Prefer remote `form` for anything with inputs and check runed.dev before hand-rolling a utility. Ask before starting a dev server. Run `bun run check && bun run test` from the repo root before committing.»_

# M8 — QA gate and release (Phase A ends here)

**Goal:** prove the product's promise, on real hardware, with evidence — then tag `v0.1.0`. Phase B does not start until this passes.

**Prev:** [M5](./M5-android-packaging.md), [M6](./M6-desktop.md), [M7](./M7-backup.md) — all green and committed.
**Next:** [M9 — landing + `packages/ui`](./M9-landing.md)

> **This milestone is manual.** Its core output is a table of observations from a physical Android device and at least one desktop OS. An agent can prepare the build and run the `adb` commands; it **cannot** tick the boxes by reasoning. Do not fabricate a single row.

---

## Files

```
docs/QA.md          the recorded results — copied into the repo as evidence
```

---

## Step 1 — quiet the repo first

```bash
cd /home/node/Documents/GitHub/Ikoro
bun run check
bun run lint
bun run test
```

- [ ] 0 check errors.
- [ ] 0 lint errors.
- [ ] All tests pass, non-zero count.
- [ ] `grep -rn "TODO\|FIXME\|XXX" apps/ packages/ --include=*.ts --include=*.svelte | grep -v node_modules` — every remaining hit is either resolved or has an owner and a milestone.

## Step 2 — the Android alarm matrix

Run the full procedure from [`../design/alarms.md`](../design/alarms.md) §4. Each row must land within **±60 s** of target, with the correct title, and tap must open the task.

```bash
adb shell dumpsys deviceidle force-idle      # Doze
adb shell am force-stop com.michaelobele.ikoro
adb shell settings put global low_power 1    # battery saver
adb reboot && <wait>
adb shell dumpsys deviceidle                 # confirm state
```

| # | Condition | Expected | Result |
| - | --------- | -------- | ------ |
| 1 | App foreground | fires on time | |
| 2 | App background | fires on time | |
| 3 | App killed (`force-stop`) | fires on time | |
| 4 | Screen off | fires on time | |
| 5 | Doze forced | fires on time | |
| 6 | Battery saver on | fires on time | |
| 7 | Reboot with a pending alarm | fires on time | |
| 8 | Exact permission **revoked mid-session** | banner appears on resume, alarms re-armed | |
| 9 | Notification posted, then `getPending()` empty | missed-detection sets `alarmFiredAt` | |
| 10 | Tap the notification | opens that task | |

- [ ] Rows 1–10 recorded with the **device model and Android version**.
- [ ] Row 7 (`reboot`) is the one risk R3 flagged — record the OEM skin, because quick-boot is where `LOCKED_BOOT_COMPLETED` restore fails.
- [ ] If a Samsung device is available, repeat rows 3, 5 and 7 on it. Samsung disables exact alarms by default for many apps, so row 8 is the interesting one there.

## Step 3 — the desktop matrix

| # | Condition | Expected | Result |
| - | --------- | -------- | ------ |
| 1 | Linux, app running | fires on time | |
| 2 | Linux, **app closed** | fires on time — scheduled by the systemd user timer | |
| 3 | Linux, timer removed by hand, alarm passes, reopen the app | surfaced as **missed** | |
| 4 | Linux, click the notification | ⚠️ no click-through in systemd mode — documented limitation, not a defect | |
| 5 | Linux, `linger` off, after logout | alarms stop — documented limitation | |
| 6 | Windows / macOS | unsupported: assert the UI says so rather than implying it works | |

- [ ] Recorded with OS, desktop environment and version.
- [ ] Row 2 is the milestone's whole point — it must be observed, not inferred from the timer being listed.
- [ ] Row 4 is a documented limitation. Do not report it as a bug, and do not invent a click-through that does not exist.

## Step 4 — Google Tasks parity walkthrough

Walk [`../design/google-tasks.md`](../design/google-tasks.md) §3 and demonstrate each ✅ row. Anything that does not actually work must be moved to ⏭ with a reason — a ⏭ is honest, a false ✅ is not.

- [ ] Multiple lists + reorder
- [ ] Title + notes
- [ ] Due date, and due **time** (our addition — Google's API cannot store it)
- [ ] Priority (our addition — Google has none)
- [ ] Complete + completed view + restore
- [ ] Manual sort
- [ ] Today with the 365-day window and the Past bucket
- [ ] Upcoming (next 7 days)
- [ ] Alarms that fire — the differentiator
- [ ] JSON backup export/import

## Step 5 — write `docs/QA.md`

- [ ] Both matrices, verbatim, with device/OS identifiers and the ± seconds observed.
- [ ] Parity results.
- [ ] Anything that failed, with the raw command and output, and whether it blocks release.
- [ ] A one-line verdict: **ship** or **do not ship**, and why.

## Step 6 — open-question sweep

Re-check the still-open items in [`../RESEARCH-2026-10.md`](../RESEARCH-2026-10.md) §4 that belong to Phase A, and the Phase A items in [`../design/decisions.md`](../design/decisions.md) "Open questions":

- [ ] Channel sound attributes — the listening test (`USAGE_ALARM` vs the default). Record what you heard.
- [ ] App name and version as shown in the launcher and in system settings.
- [ ] Name availability re-check before anything is shared publicly ([`../design/naming.md`](../design/naming.md)).

## Step 7 — tag

```bash
cd /home/node/Documents/GitHub/Ikoro
git add -A
git commit -m "docs: Phase A QA results — alarm matrix on device + desktop (M8)"
git tag v0.1.0
```

- [ ] Tag created. **Do not push the tag or publish anything without asking.**

---

## Acceptance

- [ ] Every Android matrix row fired within ±60 s on a physical device, or is documented as failing with evidence.
- [ ] Every desktop matrix row behaved as designed (rows 1–3 pass; rows 4–6 confirm documented limitations).
- [ ] `docs/QA.md` exists with real, observed values.
- [ ] `bun run check`, `bun run lint`, `bun run test` all green.
- [ ] The parity matrix has no false ✅.
- [ ] `v0.1.0` is tagged.
- [ ] **No release was published and nothing was pushed without explicit approval.**

## Findings

_(Append here if reality disagrees.)_

---

> **Prompt for the builder**
>
> _«Execute M8 of the Ikoro build plan — the QA gate. Read `docs/build/M8-qa-release.md` and `docs/design/alarms.md` §4 first. This milestone is manual: prepare the APK and the desktop build, give me the exact adb commands to run, and record the results as I report them. Do NOT tick a matrix row you did not observe and do not invent numbers. Ask before building, tagging-push, or publishing.»_

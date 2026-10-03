# M5 — Android packaging, icons, alarm channel

**Goal:** a real APK with a real icon, the right manifest permissions, an alarming notification channel — installable and behaving like an app.

**Prev:** [M4](./M4-alarm-engine.md) — engine green, spike passed on device.
**Next:** [M6 — desktop shell](./M6-desktop.md)

---

## Files

```
apps/app/capacitor.config.ts
apps/app/scripts/make-icons.ts
apps/app/static/icons/icon-192.png
apps/app/static/icons/icon-512.png
apps/app/static/icons/icon-maskable-512.png
apps/app/static/icons/icon-1024.png          ← master; reused by Tauri in M6
apps/app/android/app/src/main/AndroidManifest.xml
apps/app/android/app/src/main/res/mipmap-*/   ← launcher icons
apps/app/src/routes/+layout.svelte            ← channel creation on native launch
```

---

## Steps

### Step 1 — icon master

```bash
cd apps/app
bun add -D @resvg/resvg-js     # ~5 MB native binary — under the 300 MB threshold, proceed
```

- [ ] `scripts/make-icons.ts` draws the mark in **inline SVG** (no external asset): the gong glyph — a filled rounded rectangle with a striker circle, in the app's neutral palette.
- [ ] Renders to `static/icons/`: a **1024** master, **192**, **512**, and a **maskable 512** with the safe-zone padding (content inside the central 80% circle).
- [ ] `bun scripts/make-icons.ts` produces all four files; inspect them before continuing.
- [ ] Keep `icon-1024.png` — M6 feeds it to `tauri icon`.

### Step 2 — Capacitor config

`apps/app/capacitor.config.ts`:

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.michaelobele.ikoro',
  appName: 'Ikoro',
  webDir: 'build',
  android: { allowMixedContent: false },
};

export default config;
```

- [ ] `bun run build && bunx cap sync android`.

### Step 3 — manifest

`apps/app/android/app/src/main/AndroidManifest.xml`:

- [ ] `<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />`
- [ ] `<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />`
- [ ] `<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />`
- [ ] `<uses-permission android:name="android.permission.INTERNET" />` — sync only, and only from M11.
- [ ] App label `Ikoro`; `versionName` sourced from `package.json` so it cannot drift.
- [ ] Wire the generated icons as launcher mipmaps, including an **adaptive icon** (192/512 foreground + a solid background colour).

### Step 4 — the alarm channel

Create the channel once, on first native launch, from the native branch of `+layout.svelte`:

```ts
await LocalNotifications.createChannel({
  id: 'reminders',
  name: 'Reminders',
  description: 'Task reminders',
  importance: 5, // IMPORTANCE_HIGH — heads-up banner while unlocked
  sound: 'default',
  vibration: true,
});
```

- [ ] Called through `src/lib/alarms/` (a `ensureChannel()` on the Android scheduler) — **not** imported into `+layout.svelte` directly; the layout asks the scheduler.
- [ ] `importance: 5` is `IMPORTANCE_HIGH`; confirm the numeric value against the installed plugin's enum rather than trusting this line.
- [ ] Verify on device:
      `adb shell dumpsys notification_manager | grep -i reminders` shows the channel with high importance.

### Step 5 — build, install, smoke

```bash
cd apps/app
bun run build && bunx cap sync android
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

- [ ] App launches with the correct name and icon.
- [ ] Create a task with an alarm 2 minutes out → kill the app → the notification fires with the channel's high-importance behaviour (heads-up while unlocked).

### Step 6 — commit

```bash
cd ../../.. && git add -A
git commit -m "feat: Android packaging, app icons, alarm channel (M5)"
```

---

## Acceptance

- [ ] An APK installs on a physical device with the Ikoro name, the gong icon, and an adaptive icon.
- [ ] All four permission entries are in the manifest.
- [ ] The `reminders` channel exists with high importance, and reminders arrive as heads-up notifications while the device is unlocked.
- [ ] `appId` is `com.michaelobele.ikoro` everywhere — config, manifest, Gradle `applicationId`. Grep for a stale `com.getcapacitor.app` or a default package name.
- [ ] The icon rasteriser is a **dev** dependency; it is not bundled into the APK.

## Findings

_(Append here if reality disagrees.)_

---

> **Prompt for the builder**
>
> _«Execute M5 of the Ikoro build plan. Read `docs/build/M5-android-packaging.md` and `docs/build/00-conventions.md` first. Ask before running any Gradle build — and tell me whether you are building or just syncing. The alarm channel must be created through `src/lib/alarms/`, never imported directly into a route. Verify the channel on-device with the adb command in the milestone.»_

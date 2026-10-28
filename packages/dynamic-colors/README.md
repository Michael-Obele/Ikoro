# ikoro-dynamic-colors

A local Capacitor plugin that reads the Android 12+ Material You (Monet) tonal
palettes out of the system, so the web layer can build a Material 3 scheme from
the user's wallpaper.

Not published. Installed from the monorepo:

```bash
cd apps/app && bun add file:../../packages/dynamic-colors
```

## Why it exists

The app's theme is a Material 3 role set (`--md-sys-color-*` in
`apps/app/src/routes/layout.css`). A WebView cannot read the wallpaper palette the
OS already computed, and that is the only thing this plugin does. The mapping from
tones to roles, the oklch() conversion and the CSS variable writes all live in
`apps/app/src/lib/theme/monet.ts`, in TypeScript, where they are unit tested
without a device.

## API

```ts
import { IkoroDynamicColors, readDynamicPalettes } from 'ikoro-dynamic-colors';

const { available, sdkInt, palettes } = await IkoroDynamicColors.getPalettes();
// available: false on web and on Android < 12 (API 31)
// palettes: { accent1: { '0': '#000000', '10': '#...', ... }, accent2: {...}, ... }

const { available, sdkInt } = await IkoroDynamicColors.isAvailable();
```

`getPalettes()` resolves with `available: false` rather than rejecting when the
platform cannot supply a palette. "This phone has no wallpaper palette" is an
answer, not an error.

## Palettes and tones

Five palettes, thirteen tones each, as `#rrggbb`:

| Palette    | Android resource                    |
| ---------- | ----------------------------------- |
| `accent1`  | `android.R.color.system_accent1_*`  |
| `accent2`  | `android.R.color.system_accent2_*`  |
| `accent3`  | `android.R.color.system_accent3_*`  |
| `neutral1` | `android.R.color.system_neutral1_*` |
| `neutral2` | `android.R.color.system_neutral2_*` |

Tones: `0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000`.

## Android wiring

The plugin is a Gradle library module. `bunx cap sync android` regenerates
`apps/app/android/capacitor.settings.gradle` and `capacitor.build.gradle` to
include it, and `MainActivity.java` registers the class before
`super.onCreate()`:

```java
registerPlugin(IkoroDynamicColorsPlugin.class);
```

Registering after `super.onCreate()` attaches nothing, silently: every JS call
then rejects with "not implemented" and nothing in logcat explains why.

No permission is required. The `system_*` colours are public framework
resources.

# Releasing Ikoro (Android)

How to set up signing and cut a release that uploads a signed APK + AAB to GitHub Releases.

The pipeline lives in [.github/workflows/release-android.yml](.github/workflows/release-android.yml). It triggers on any tag `v*` and asserts the tag equals `apps/app/package.json`'s `version` before building — a release whose Settings screen and package manager disagree about the version is worse than no release.

> **BUN ONLY.** This repo never uses npm/npx/pnpm/yarn. `bunx` is the npx equivalent.

---

## 1. One-time keystore creation (local, never committed)

The keystore is the app's identity. Generate it once, on your machine:

```bash
keytool -genkeypair -v -keystore ikoro.keystore -alias ikoro \
  -keyalg RSA -keysize 2048 -validity 10000
```

It prompts for a **store password** and a **key password** (they can be the same). Remember both — they go into secrets next.

> **⚠️ Keep an offline copy of `ikoro.keystore`.** Lose it and the app can never be updated under `com.michaelobele.ikoro` again — Google Play and Android both reject an update signed by a different key. The file is gitignored; do not commit it.

## 2. Encode the keystore for GitHub

GitHub secrets hold text, so the binary keystore goes in base64:

```bash
base64 -w0 ikoro.keystore > ikoro.keystore.b64
```

(`-w0` disables line wrapping — the secret must be a single line.)

## 3. Set the four GitHub secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**. Create exactly these four:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_B64` | the full contents of `ikoro.keystore.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | the store password from step 1 |
| `ANDROID_KEY_ALIAS` | `ikoro` |
| `ANDROID_KEY_PASSWORD` | the key password from step 1 |

With the [`gh`](https://cli.github.com) CLI instead of the web UI:

```bash
gh secret set ANDROID_KEYSTORE_B64 < ikoro.keystore.b64
gh secret set ANDROID_KEYSTORE_PASSWORD   # prompts
gh secret set ANDROID_KEY_ALIAS           # prompts — enter: ikoro
gh secret set ANDROID_KEY_PASSWORD        # prompts
```

Verify they're set (values stay hidden):

```bash
gh secret list
```

## 4. Cut a release

Bump the version, commit, and tag in one step:

```bash
bun scripts/bump-version.ts 0.2.0
git push && git push --tags
```

`bump-version.ts` writes the version into `apps/app/package.json`, commits it as `chore: bump version to v0.2.0`, and tags `v0.2.0`. It refuses to run on a dirty tree or an existing tag. Pushing the tag triggers the workflow; the signed `app-release.apk` and `app-release.aab` appear on the **Releases** tab when it finishes.

## 5. Rotating a secret

GitHub secrets are write-only — there is nothing to read back or "update in place". To change one, re-set it:

```bash
gh secret set ANDROID_KEYSTORE_PASSWORD   # prompts for the new value
```

The next release run picks it up. No workflow change needed.

---

## Troubleshooting

- **`tag X != package.json Y`** — the tag and `apps/app/package.json` disagree. Re-run `bun scripts/bump-version.ts` so they match, then push the new tag.
- **`ANDROID_KEYSTORE_B64 is not set`** — step 3 was skipped or the secret name has a typo. Names must match exactly.
- **Verify artifacts are signed fails** — the signing block did not apply. Confirm all four secrets are set; the block is env-gated and silently skips signing when `IKORO_KEYSTORE` is absent.

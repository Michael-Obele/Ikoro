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

## 4. Which bump does my commit need? (commit → version)

**Every commit is a patch.** Only two things move the number higher, and both have to be written
into the commit message:

| Your commit says | Bump | Because |
| --- | --- | --- |
| `feat: …` | **minor** `0.3.0 → 0.4.0` | a new capability a user can find |
| `feat!: …` · `feat(x)!: …` · a `BREAKING CHANGE:` footer | **major** `0.4.0 → 1.0.0` | it changes a data contract, the storage schema, or what an existing install has to do |
| anything else conventional — `fix:`, `perf:`, `refactor:`, `docs:`, `chore:`, `ci:`, `build:`, `test:`, `style:`, `revert:` | **patch** `0.3.0 → 0.3.1` | nothing a user relies on changed |

The cheap default is deliberate. "Minor" promises the user will find something new, and "major"
promises that something they already do will stop working; on a store listing neither can be taken
back. So the bump is never guessed from the diff — it is taken from what the commit says.

Derive it instead of choosing it:

```bash
bun apps/app/scripts/version.ts auto
```

It prints every commit since the last tag alongside the level it claims, then bumps by the largest.
A message that is not Conventional Commits cannot claim a level, so `auto` reports it and counts it
as a patch — which is why the workflow below refuses to ship one.

The rule, the parser and the guard are one file:
[`apps/app/scripts/version.ts`](apps/app/scripts/version.ts).

### What the release workflow checks

On every `v*` tag, before anything is built, the run fails if:

- **the tag is smaller than its history claims** — a `feat:` since the previous tag needs a minor, a
  `!` needs a major. A **bigger** bump is always allowed; only a smaller one is refused.
- **a commit since the previous tag does not parse** — an unclassifiable message claims nothing, so a
  feature hiding in one would ship as a patch. Reword it before tagging.
- the tag and `apps/app/package.json` disagree.

Run the same check locally: `bun apps/app/scripts/version.ts check`.

## 5. Cut a release

Let the commits choose the bump, then commit, tag, and push:

```bash
bun apps/app/scripts/version.ts auto    # or an explicit 0.4.0 / major / minor / patch
git add apps/app/package.json
git commit -m "chore(release): v0.4.0"
git tag v0.4.0
git push origin master --tags
```

`version.ts` only writes the version into `apps/app/package.json` and prints these commands — it
never commits or tags, because a release tag is a deliberate act. Pushing the tag triggers the
workflow; the signed APK and AAB appear on the **Releases** tab when it finishes.

## 6. Rotating a secret

GitHub secrets are write-only — there is nothing to read back or "update in place". To change one, re-set it:

```bash
gh secret set ANDROID_KEYSTORE_PASSWORD   # prompts for the new value
```

The next release run picks it up. No workflow change needed.

---

## Troubleshooting

- **`tag X != package.json Y`** — the tag and `apps/app/package.json` disagree. Re-run `bun apps/app/scripts/version.ts auto` so they match, then push the new tag.
- **`ANDROID_KEYSTORE_B64 is not set`** — step 3 was skipped or the secret name has a typo. Names must match exactly.
- **Verify artifacts are signed fails** — the signing block did not apply. Confirm all four secrets are set; the block is env-gated and silently skips signing when `IKORO_KEYSTORE` is absent.

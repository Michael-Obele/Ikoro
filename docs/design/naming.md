# Ikoro — Naming

Back to [README](./README.md).

Process per the **naming-psychology** skill: emotional target → candidate generation (⅓ Ijaw, ⅓ Chinese/Japanese, ⅓ metaphor) → 7-principle scorecard (/35) → availability on npm + GitHub + web (±3 discoverability) → fluency veto.

## Emotional target

What should the name feel? **"It will get you."** Dependability + a call to attention — the app is a personal town crier: it announces, you hear it. Not gentle, not naggy: the deep, unmistakable sound of a gong at the appointed time.

## Candidate generation

### Ijaw (primary — heritage, and the source that named Aghara)

Mined Roger Blench's [_A Dictionary of Ịbani, an Ijoid Language of the Niger Delta_](https://web.archive.org/web/20240724051551/https://www.rogerblench.info/Language/Niger-Congo/Ijoid/Ibani/Ibani-English%20dictionary.pdf) (Wayback snapshot — the live URL 404s as of 2026-09-25), the same source as Aghara's "word list #112 — town crier":

| Ịbani headword | Gloss (dictionary, verbatim)                                 | Candidate?                       |
| -------------- | ------------------------------------------------------------ | -------------------------------- |
| **ikoro**      | large slit-gong used for announcements or to call assemblies | ✅ top pick                      |
| **gbóm**       | bell                                                         | ✅ runner-up                     |
| **saghí**      | get up; wake up                                              | ✅ third                         |
| **sịsáī**      | wake (someone) up                                            | ⚠️ tone marks make spelling hard |
| **naá bō**     | wake from sleep; resurrect                                   | ❌ two words                     |
| **dédé**       | morning; first meeting of the day                            | ❌ personal name everywhere      |
| **kúrū**       | keep watch; wait; tarry                                      | ❌ weak / sounds like "cuckoo"   |
| Aghara         | town crier                                                   | ❌ already the social scheduler  |

### Chinese / Japanese

| Candidate          | Meaning                       | Verdict                                                              |
| ------------------ | ----------------------------- | -------------------------------------------------------------------- |
| **Mezame**         | 目覚め — awakening            | ❌ **VETO** — existing alarm app "Mezame" on App Store (exact space) |
| **Todoke**         | 届け — let it reach           | ❌ npm taken; in Japanese means bureaucratic "filing form" (届)      |
| Ting / Xing / Ling | 听 listen / 醒 wake / 铃 bell | ❌ dominated (Ting telecom, XING, Ling language app)                 |
| Yobi / Koe         | 呼び call / 声 voice          | ⚠️ npm taken, homophone confusion (yōbi = weekday)                   |

### Metaphor (English)

| Candidate             | Idea                 | Verdict                                |
| --------------------- | -------------------- | -------------------------------------- |
| Lest                  | "lest you forget"    | ⚠️ literary/archaic, 6035 GH name hits |
| Peal                  | a peal of bells      | ⚠️ free on npm but dictionary-flat     |
| Bugle                 | reveille call        | ❌ npm taken, Google "Bugle" history   |
| Gong                  | the sound itself     | ❌ dominated by Gong (gong.io)         |
| Hark/Rouse/Chime/Gong | listen / wake / ring | ❌ npm taken or major brand            |

## Scorecard (7 principles /35 + discoverability ±3)

Checked 2026-09-25: npm = `curl -s -o /dev/null -w "%{http_code}" https://registry.npmjs.org/<name>` (404 = free); GitHub = repo search counts; web = open-web top-5 inspection.

| #   | Principle          | Ikoro     | Gbom   | Saghi  |
| --- | ------------------ | --------- | ------ | ------ |
| 1   | Fluency (veto)     | 4         | **3**  | 3      |
| 2   | Sound symbolism    | 4         | 5      | 4      |
| 3   | Von Restorff       | 5         | 5      | 4      |
| 4   | Emotional encoding | 5         | 5      | 5      |
| 5   | Zeigarnik          | 4         | 4      | 3      |
| 6   | Serial position    | 3         | 4      | 4      |
| 7   | Cognitive load     | 3         | 5      | 4      |
|     | **Subtotal**       | **28**    | **30** | **27** |
|     | Discoverability    | **+3**    | +1     | +2     |
|     | **Total**          | **31/38** | 31/38  | 29/38  |

Notes:

- **Ikoro** — npm `404` (free), GitHub **73** repos (top hits = personal student projects, no dominant repo), web = **Green**: page 1 is Wikipedia's cultural article on the instrument + academic/Facebook pages, zero products. Weakness: 3 syllables and a vowel opening (Serial 3) — but the stressed **KOR** carries the punch, and `gb`-cluster-free spelling survives the 5-stranger test.
- **Gbom** — highest raw score, but **fluency 3**: the `gb` cluster is a hard sell for non-Ijaw speakers (the same reason it's a great story). Ties on total with Ikoro; fluency is the tiebreaker and the skill ranks fluency as a veto dimension. npm free, GitHub 63, but web has noise (Flavour song "Gbo Gan Gbom") → +1.
- **Saghi** — the `gh` digraph trips English spellers; npm free; less checked → +2.

**Decision (Michael, 2026-09-25): `Ikoro`.** Higher fluency, same total, cleanest web page, and the portfolio story writes itself.

## The story (for README / store listing)

> **Ikoro** (ih-KOR-oh) — Ịbani (Ijaw) for the slit-gong that called assemblies. In the Niger Delta, when the ikoro sounded, it was time — market, council, homecoming. Ikoro does that for your tasks: set the time, and it calls you. Where Aghara (the sibling project) is the town crier who announces your posts to the world, Ikoro is the gong that rings for **you**.

Tagline options (test later):

1. "The gong that calls you." (recommended)
2. "Set the time. Ikoro calls."
3. "Reminders that actually fire."

## Pre-launch re-checks (before registering anything)

- [ ] Re-run npm / GitHub / Play Store / appstore name search the day before publishing.
- [ ] Reserve: repo `<org>/ikoro`, npm `ikoro` (if ever published), handle `@ikoro` on Bluesky/Mastodon.
- [ ] Trademark knock-out search (US/EU) if the name expands beyond a personal project.

---

Back to [README](./README.md) · Related: [research.md](./research.md) · [decisions.md](./decisions.md)

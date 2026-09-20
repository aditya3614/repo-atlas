# Repo Atlas

Turns a git history into an animated, explorable map of a codebase. Every file
is a cell in a treemap sized by an estimate of its size; a time scrubber plays
the history forward and back.

Everything runs in the browser tab. No backend, no accounts, no uploads, no
analytics. After the page loads the app makes no network requests at all except
for its own self-hosted font files. It only ever sees commit metadata and line
counts, never file contents.

## Status

- **M0 — scaffold and identity: done.** Tokens, both themes, landing screen with
  the ambient map, command panel, drop zone, error and empty states.
- **M1 — parse and model: done.** Streaming parser in a module worker, columnar
  data model, checkpoint index, loading and error screens, the bundled axios
  demo, and a seeded synthetic generator.
- **M2 — the map: done.** Treemap layout in the worker, canvas renderer, five
  colour modes with legends, hover, selection, and drill-down zoom with a
  breadcrumb, at the latest commit.
- **M3 — time: done.** Streamgraph scrubber, playback with speed and
  quiet-period skipping, animated transitions for files appearing, moving and
  disappearing, the commit ticker, and the keyboard transport. Co-change arcs
  came forward from the stretch list on request.
- **M4 — meaning: done.** Story facts, the Hotspots tab, single-owner folders,
  the full Selection panel, fuzzy search, and a typography and contrast pass
  across both themes.
- M5 finish: to come.

## Running it

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # unit tests (vitest)
npm run e2e       # end to end + screenshots into shots/ (Playwright)
npm run build
```

`npm run e2e` builds and previews first. Set `PW_SYSTEM_CHROME=1` to run against
the system Chrome when Playwright's browsers are not installed.

The performance tests need a synthetic history, which they generate on demand
into `.cache/`. To make one by hand:

```bash
node scripts/make-synthetic.mjs --commits=100000 --files=20000 .cache/synthetic.txt
```

It is seeded, so the same arguments always produce the same bytes. It contains
bursts, a long quiet gap, renames, directory-wide refactors, deletions, bot
commits, rebased-looking dates, and one folder with a single owner.

## Input

```bash
git -c core.quotepath=false log --reverse --no-merges -M --numstat \
  --format='@@@%n%H%n%an%n%ae%n%aI%n%s' > atlas.txt
```

Drop `atlas.txt` on the landing screen, or paste the output directly. Both go
through the same streaming path.

## How it works

The worker streams the file through `TextDecoderStream` and a line parser that
reads commits **by position**, never by splitting on a separator — a commit
subject may contain tabs, pipes, quotes or the literal string `@@@`. Partial
lines are carried across chunk boundaries, so the result does not depend on how
the file arrives.

The history is stored columnar: one typed array per field, plus the changes in
compressed-sparse-row form. There is no object per change; a 100k-commit history
is ~916k changes and objects for those would not fit the budget.

To show commit *k*, the state of every file (size, alive, path, heat) is
restored from the nearest checkpoint at or before *k* and replayed forward.
Scrubbing therefore never replays from the start.

The map is laid out in the worker with `treemapSquarify` and shipped to the
main thread as transferable typed arrays — geometry plus one array per
attribute the renderer needs. Sibling order is by name, never by size, so a
growing file never makes its neighbours jump. Cell areas use `size ^ 0.6` by
default; raw line counts let one generated file swallow the picture.

Drawing is two canvases: cells and folder borders on the base, hover, selection
and glows on the overlay. Colours come from 64-entry lookup tables rebuilt only
when the theme changes, so a frame does no interpolation and no allocation.

Playback keeps its position, speed and commit index in a plain mutable object
that the frame loop reads directly. React subscribes to it separately and is
told at about eleven times a second — enough for a date readout, far too slow
to drive a map. Layouts are requested one at a time as the commit advances, and
the main thread tweens cell to cell between them: a file that survives slides
and resizes, one that is new grows in with a flash, one that has gone collapses
to an outline.

Story facts, hotspots and folder ownership are recomputed in the worker when
the playhead settles, never while it is moving. Every sentence states the window
it was measured over: a hotspot says how many commits, how many people and over
how many months, and a single-owner claim gives the share it is based on.

### Colour and type

Text contrast is enforced by a test, not by eye. `src/styles/contrast.test.ts`
reads the tokens out of the stylesheet and checks every pairing the UI uses in
both themes against the 4.5:1 requirement in section 11. It found three real
failures, all now fixed: Paper's faint text on a tinted surface, and two ramp
stops that sat in a mid-tone band where neither black nor white text works.

Map labels sit directly on a cell whose colour is data, so no single ink can
work: a grey that reads on a dark cell vanishes on a hot yellow one. Each cell
now picks its ink from its own luminance, and the same test checks both inks
against every cell colour in both themes.

Three faces, each with a job: **Inter** for the interface, **Source Code Pro**
with tabular figures for paths and numbers, and **Newsreader** for the story
sentences, which are prose rather than chrome.

### Measured, on this machine (M-series MacBook Air, Chromium 1243)

| | |
| --- | --- |
| Synthetic input | 46.9 MB, 100,000 commits, 22,512 files, 915,810 changes |
| Parse | 285–306 ms (Node, verified separately from the browser) |
| Checkpoint index | 25 ms |
| Whole load in the browser, click to loaded | 406 ms (budget: 10 s) |
| Demo, click to loaded | 171 ms (budget: 2 s to first map) |
| Dataset + index footprint | 77 MB (budget: 500 MB) |
| Map layout, 22,302 cells, in the worker | 18 ms |
| Hover across a 22k-cell map | 16.7 ms median and p95, worst 16.8 ms |
| Switching colour mode (full redraw of every cell) | 16.7 ms median and p95 |
| The same at retina density, four times the pixels | 16.7 ms median and p95 |
| Playing the synthetic history at 4x | 16.7 ms median and p95, worst 16.8 ms |
| Dragging the playhead across the whole timeline | 16.7 ms median and p95 |
| Ownership, hotspots and story facts over 100k commits | ~200 ms in total |

The footprint is computed from the typed arrays' actual `byteLength` plus a
two-bytes-per-character estimate for the string tables. It is reported rather
than guessed because `performance.memory` on the main thread cannot see the
worker's heap, where the dataset lives.

## Decisions

Points where the brief left room, or where two instructions pulled in different
directions. Recorded here as they are made.

- **Theme comes from the Wise design system, not from the brief's §8 palette.**
  The brief specifies a warm cartography palette (terracotta, sage, sand on
  `#141413`); the instruction that came with it said to take the theme from the
  attached Wise design file. Wise wins on colour and type; the brief's
  *structure* is kept intact — two named themes, and accents that hold one fixed
  meaning each:

  | role | token | Wise colour |
  | --- | --- | --- |
  | new / added | `--accent` | Lime `#9FE870` (Night) / Deep Forest `#163300` (Paper) |
  | selection / info | `--info` | Cyan `#A0E1E1` |
  | deleted / removed | `--danger` | Error red `#CB272F` |
  | recent activity | `--heat-0…4` | charcoal → lime → warm yellow → `#FFD11A` |

  Night stays the default, as the brief asks, because heat glows read better on
  a dark ground. Paper is Wise's own white-on-forest-green world.
- **Wise Sans is replaced by Inter 900.** Wise Sans is not distributable, and
  the Wise file names Inter as the primary family. Display text uses Inter 900
  with tight leading and negative tracking, which is the closest honest stand-in.
  Newsreader (the brief's serif for story text) is dropped for the same reason:
  the Wise system is single-family, and mixing a serif in would read as a
  different product.
- **Source Code Pro is kept** for paths and numbers, with `tabular-nums`, since
  the Wise file has no monospace face and columns of digits must not jitter.
- **The heat ramp is a 64-entry lookup table**, rebuilt on theme change, so no
  frame allocates a colour interpolator.
- **Same-origin font files are the one allowed request after load.** The privacy
  test asserts exactly that and fails on anything else.
- **The demo ships as plain text, not gzipped.** Static servers set
  `Content-Encoding: gzip` on a `.gz` file, the browser then decompresses it
  transparently, and the worker's own gunzip is handed plain text and fails.
  Transport compression handles the wire anyway. The worker's `DecompressionStream`
  path is still there for `.gz` files people drop themselves.
- **Checkpoints are every 256 commits, widened when that would not fit memory.**
  The brief asks for 256. At 20,000 files, 100,000 commits, that would be 391
  snapshots of 420 KB each — about 230 MB, which breaks the 500 MB budget on its
  own. The interval doubles until the index fits 48 MB; on the synthetic dataset
  it settles at 1,024, so a scrub replays at most 1,023 commits (~9,400 change
  applications, well under one frame). On the demo it stays at 256.
- **Hover has a three-pixel tolerance.** The layout leaves a 1px gap between
  cells and a 15px label gutter above each folder, so a strict containment test
  left dead seams criss-crossing the map. A miss now falls back to the nearest
  cell within three pixels.
- **Paper outlines hot cells instead of glowing them.** Additive blending needs
  a dark ground; on white it turns a glow into a grey smudge. The dark theme
  keeps the pre-rendered additive sprite, and Paper draws a 1.5px amber ring
  around the same cells.
- **Drilling into a folder is also reachable from the keyboard.** On the canvas
  you click a folder's label strip, which nothing can tab to, so the Selection
  panel renders the file's folder path as buttons that do the same thing.
- **The streamgraph's wiggle baseline is de-drifted.** `stackOffsetWiggle`
  minimises slope changes but its baseline random-walks: over 632 weeks of the
  demo it wandered 224 units while the ribbon was only 29 thick, so fitting the
  whole range left a thread on an empty canvas. A heavily smoothed centre is
  subtracted per column, which removes the long-range drift and keeps the local
  wiggle the brief asks for.
- **Co-change ignores sweeping commits.** Counting every pair in every commit is
  quadratic in the commit's size, and a 400-file refactor would contribute
  80,000 pairs that mean nothing more than "these all moved at once". Only
  commits touching between 2 and 20 files are counted, over the 600 busiest
  files, and the caption states how many commits that was.
- **`heatAt` and `lastTouch` are one field.** Both are only ever written at a
  touch, with the same value, so the model keeps one and saves 8 bytes per file
  per checkpoint.

## The demo's story cards, checked by hand

Section 13 asks for these to be spot-checked against `git log`. Against the
axios clone, on 21 September 2026:

| Card | Repo Atlas | git |
| --- | --- | --- |
| Busiest year | 2026, 386 commits | 386 |
| First commit | 18 Aug 2014, Matt Zabriskie, "first commit" | same |
| Largest commit | ~52k lines, "refactor: bump minors package versions (#7356)", Jay | 51,771 lines, same commit |
| Longest quiet spell | 139 days, 17 Sep 2018 to 4 Feb 2019 | same |
| Busiest week | 29 commits, week of 2 Jun 2022 | same |

Two of these needed care rather than just a check:

- **The longest gap is 139 days, not the 165 that git's linear order suggests.**
  Thirteen commits in axios carry an author date earlier than the commit before
  them, which is what a rebase leaves behind. Sorting the author dates gives
  139 days, and that is the number a person would verify. The running-maximum
  time axis agrees with it.
- **The busiest week excludes bots**, exactly as the streamgraph does — 29
  rather than the 33 that counting dependabot would give. The sentence now says
  so, because the same week is the busiest either way only by coincidence.

Two wordings were wrong before they were checked, and were rewritten to say what
was actually measured. "Everything in tests was written by Jay" became "Jay
wrote 86% of its 59k lines … with 86 others accounting for the rest", which is
what a bus factor of 1 under the 80% rule actually means. And "rewritten about
328 times over" turned out to be churn divided by a file our own size estimate
had left at a handful of lines; it now reports the churn and the size separately,
and only for files of at least 80 lines.

## Honest numbers

File size is estimated from `--numstat` line counts, never measured. Binary
files have no line counts at all and are given a constant weight of 30. Anywhere
the UI shows a size it says so.

The live file set is an estimate too, and its error is measurable. Against the
bundled axios demo, the model's live files at the last commit were compared with
`git ls-files`:

- every one of the 473 files git reports is present;
- 7 extra files are still shown, an overshoot of about 1.5%.

Those 7 break down as one deleted binary — a binary row carries no line counts,
so its removal is indistinguishable from an edit — and six files whose deletion
exists only inside a merge commit, which the brief's `--no-merges` log cannot
see. Both are properties of the input format, not of the model, and
`src/worker/demo.test.ts` pins the numbers so a real regression would show up.

These demo figures were each checked against git by hand and match exactly:
1,987 commits, 676 author identities, 214 bot commits, 2014–2026.

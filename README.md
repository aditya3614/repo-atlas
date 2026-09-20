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
- M1 parse and model · M2 the map · M3 time · M4 meaning · M5 finish: to come.

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

## Input

```bash
git -c core.quotepath=false log --reverse --no-merges -M --numstat \
  --format='@@@%n%H%n%an%n%ae%n%aI%n%s' > atlas.txt
```

Drop `atlas.txt` on the landing screen, or paste the output directly. Both go
through the same streaming path.

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

## Honest numbers

File size is estimated from `--numstat` line counts, never measured. Binary
files have no line counts at all and are given a constant weight. Anywhere the
UI shows a size it says so.

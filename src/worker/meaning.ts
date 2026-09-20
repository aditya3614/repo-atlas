import type { Dataset } from './model';
import type { FileState } from './state';
import type { FileIndex } from './fileIndex';
import type { Timeline } from './timeline';

/**
 * The parts that say something in words: what is churning, who owns what, and
 * a handful of facts about the history. Every number here is reported with the
 * window it was measured over, because "hot" means nothing without a period.
 */

const DAY = 86_400_000;
const MONTH = 30 * DAY;

export interface Hotspot {
  fileId: number;
  path: string;
  score: number;
  commits: number;
  authors: number;
  lines: number;
  reason: string;
}

export interface FolderOwnership {
  path: string;
  busFactor: number;
  topAuthor: number;
  topShare: number;
  authors: number;
  lines: number;
  files: number;
}

export interface StoryFact {
  id: string;
  kind: string;
  text: string;
  /** Commit to jump to when the card is clicked. */
  jumpTo: number;
  focusPath?: string;
}

/** Recent window: the last quarter of the history, or a year, whichever is shorter. */
export function hotspotWindow(d: Dataset, commit: number): { from: number; days: number } {
  const now = d.time[commit] ?? 0;
  const first = d.time[0] ?? now;
  const quarter = (now - first) * 0.25;
  const span = Math.max(DAY, Math.min(quarter, 12 * MONTH));
  return { from: now - span, days: Math.round(span / DAY) };
}

export function hotspots(
  d: Dataset,
  state: FileState,
  commit: number,
  limit: number,
): { list: Hotspot[]; windowDays: number } {
  const { from, days } = hotspotWindow(d, commit);
  const months = Math.max(1, Math.round(days / 30));

  const churn = new Float64Array(d.fileCount);
  const touches = new Uint32Array(d.fileCount);
  // Distinct authors per file, tracked as a bitmask over the top 32 authors
  // plus an exact count for the rest, which is enough to rank by.
  const authorSets = new Map<number, Set<number>>();

  for (let k = 0; k <= commit; k++) {
    if (d.time[k]! < from) continue;
    const a = d.author[k]!;
    for (let i = d.offsets[k]!; i < d.offsets[k + 1]!; i++) {
      const f = d.fileIds[i]!;
      churn[f]! += d.adds[i]! + d.dels[i]!;
      touches[f]!++;
      let set = authorSets.get(f);
      if (!set) {
        set = new Set();
        authorSets.set(f, set);
      }
      set.add(a);
    }
  }

  const list: Hotspot[] = [];
  for (const [f, set] of authorSets) {
    if (state.alive[f] === 0) continue;
    const lines = churn[f]!;
    if (lines === 0) continue;
    const people = set.size;
    const score = lines * Math.log(1 + people);
    list.push({
      fileId: f,
      path: d.paths[state.pathIndex[f]!]!,
      score,
      commits: touches[f]!,
      authors: people,
      lines,
      reason:
        `changed ${touches[f]!} time${touches[f]! === 1 ? '' : 's'} in ${months} month` +
        `${months === 1 ? '' : 's'} by ${people} ${people === 1 ? 'person' : 'people'}, ` +
        `about ${compact(lines)} lines`,
    });
  }

  list.sort((a, b) => b.score - a.score);
  return { list: list.slice(0, limit), windowDays: days };
}

function compact(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

/**
 * Lines added per author per folder, up to a commit, with each file counted
 * against every folder above it. The bus factor is the smallest number of
 * non-bot authors covering 80% of those lines.
 */
export function ownership(
  d: Dataset,
  state: FileState,
  commit: number,
): Map<string, FolderOwnership> {
  // The folder a file belongs to is its folder *now*, not when it was written.
  const fileFolders = new Map<number, string[]>();
  for (let f = 0; f < d.fileCount; f++) {
    if (state.alive[f] === 0) continue;
    const path = d.paths[state.pathIndex[f]!]!;
    const parts: string[] = [];
    let at = path.indexOf('/');
    while (at !== -1) {
      parts.push(path.slice(0, at));
      at = path.indexOf('/', at + 1);
    }
    fileFolders.set(f, parts);
  }

  const perFolder = new Map<string, Map<number, number>>();
  const fileCounts = new Map<string, Set<number>>();

  for (let k = 0; k <= commit; k++) {
    const a = d.author[k]!;
    if (d.authors.bot[a] === 1) continue;
    for (let i = d.offsets[k]!; i < d.offsets[k + 1]!; i++) {
      const f = d.fileIds[i]!;
      const folders = fileFolders.get(f);
      if (!folders) continue;
      const adds = d.adds[i]!;
      for (const folder of folders) {
        let m = perFolder.get(folder);
        if (!m) {
          m = new Map();
          perFolder.set(folder, m);
        }
        m.set(a, (m.get(a) ?? 0) + adds);
        let fs = fileCounts.get(folder);
        if (!fs) {
          fs = new Set();
          fileCounts.set(folder, fs);
        }
        fs.add(f);
      }
    }
  }

  const out = new Map<string, FolderOwnership>();
  for (const [folder, byAuthor] of perFolder) {
    const entries = [...byAuthor.entries()].sort((x, y) => y[1] - x[1]);
    let total = 0;
    for (const [, lines] of entries) total += lines;
    if (total <= 0) continue;

    let running = 0;
    let bus = 0;
    for (const [, lines] of entries) {
      running += lines;
      bus++;
      if (running >= total * 0.8) break;
    }

    out.set(folder, {
      path: folder,
      busFactor: bus,
      topAuthor: entries[0]![0],
      topShare: entries[0]![1] / total,
      authors: entries.length,
      lines: total,
      files: fileCounts.get(folder)?.size ?? 0,
    });
  }
  return out;
}

/** Folders only one person has really written, biggest first. */
export function singleOwner(own: Map<string, FolderOwnership>, limit: number): FolderOwnership[] {
  return [...own.values()]
    .filter((o) => o.busFactor === 1 && o.files > 1)
    .sort((a, b) => b.lines - a.lines)
    .slice(0, limit);
}

export function storyFacts(
  d: Dataset,
  index: FileIndex,
  state: FileState,
  timeline: Timeline,
  own: Map<string, FolderOwnership>,
  peakAlive: number,
  peakAliveAt: number,
): StoryFact[] {
  const facts: StoryFact[] = [];
  const name = (a: number) => d.authors.names[a] ?? 'someone';

  // 1. The busiest year.
  const byYear = new Map<number, { n: number; first: number }>();
  for (let k = 0; k < d.commitCount; k++) {
    const y = new Date(d.time[k]!).getUTCFullYear();
    const hit = byYear.get(y);
    if (hit) hit.n++;
    else byYear.set(y, { n: 1, first: k });
  }
  const busiest = [...byYear.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  if (busiest) {
    facts.push({
      id: 'busiest-year',
      kind: 'Busiest year',
      text: `${busiest[0]} was the busiest year, with ${busiest[1].n.toLocaleString()} commits.`,
      jumpTo: busiest[1].first,
    });
  }

  /*
   * 2. The file that churns hardest for its size. Both thresholds matter: a
   * file our size estimate has left at a handful of lines would otherwise win
   * every time, and the claim would be an artefact of the estimate rather than
   * anything about the repository.
   */
  let bestRatio = 0;
  let rewritten = -1;
  for (let f = 0; f < d.fileCount; f++) {
    if (state.alive[f] === 0) continue;
    const size = state.size[f]!;
    if (size < 80 || d.files.commitCount[f]! < 8) continue;
    const ratio = (d.files.adds[f]! + d.files.dels[f]!) / size;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      rewritten = f;
    }
  }
  if (rewritten >= 0) {
    const last = index.fileChanges[index.fileOffsets[rewritten + 1]! - 1]!;
    const churnTotal = d.files.adds[rewritten]! + d.files.dels[rewritten]!;
    facts.push({
      id: 'most-rewritten',
      kind: 'Churns hardest',
      text:
        `${d.paths[state.pathIndex[rewritten]!]} has had about ${compact(churnTotal)} lines ` +
        `changed across ${d.files.commitCount[rewritten]!.toLocaleString()} commits, for a file ` +
        `that is only around ${compact(state.size[rewritten]!)} lines long.`,
      jumpTo: index.changeCommit[last]!,
      focusPath: d.paths[state.pathIndex[rewritten]!]!,
    });
  }

  /*
   * 3. A folder one person effectively owns. The sentence states the share it
   * was measured from: "single owner" here means the 80% rule, not that nobody
   * else ever committed to the folder.
   */
  const solo = singleOwner(own, 1)[0];
  if (solo) {
    const others = solo.authors - 1;
    facts.push({
      id: 'single-owner',
      kind: 'Single owner',
      text:
        `${solo.path} is effectively one person's work: ${name(solo.topAuthor)} wrote ` +
        `${Math.round(solo.topShare * 100)}% of its ${compact(solo.lines)} lines across ` +
        `${solo.files} file${solo.files === 1 ? '' : 's'}` +
        (others > 0
          ? `, with ${others} other${others === 1 ? '' : 's'} accounting for the rest.`
          : ', and nobody else has added a line.'),
      jumpTo: d.commitCount - 1,
      focusPath: solo.path,
    });
  }

  // 4. The largest single commit.
  let biggest = 0;
  let biggestLines = 0;
  for (let k = 0; k < d.commitCount; k++) {
    let lines = 0;
    for (let i = d.offsets[k]!; i < d.offsets[k + 1]!; i++) lines += d.adds[i]! + d.dels[i]!;
    if (lines > biggestLines) {
      biggestLines = lines;
      biggest = k;
    }
  }
  facts.push({
    id: 'largest-commit',
    kind: 'Largest commit',
    text:
      `The largest single commit touched about ${compact(biggestLines)} lines: ` +
      `“${(d.subjects[biggest] ?? '').slice(0, 70)}”, by ${name(d.author[biggest]!)}.`,
    jumpTo: biggest,
  });

  // 5. The longest silence.
  let gap = 0;
  let gapAt = 0;
  for (let k = 1; k < d.commitCount; k++) {
    const g = d.time[k]! - d.time[k - 1]!;
    if (g > gap) {
      gap = g;
      gapAt = k - 1;
    }
  }
  if (gap > 3 * DAY) {
    facts.push({
      id: 'quiet-gap',
      kind: 'Longest quiet spell',
      text:
        `Nothing was committed for ${Math.round(gap / DAY)} days, ` +
        `between ${date(d.time[gapAt]!)} and ${date(d.time[gapAt + 1]!)}.`,
      jumpTo: gapAt,
    });
  }

  // 6. Who wrote most of the biggest folder.
  const top = [...own.values()]
    .filter((o) => !o.path.includes('/'))
    .sort((a, b) => b.lines - a.lines)[0];
  if (top) {
    facts.push({
      id: 'top-folder-owner',
      kind: 'Who owns the biggest folder',
      text:
        `${top.path} is the biggest folder, at about ${compact(top.lines)} lines added over time. ` +
        `${name(top.topAuthor)} wrote ${Math.round(top.topShare * 100)}% of them` +
        `${top.authors === 1 ? ' — nobody else has.' : `, out of ${top.authors} people who have.`}`,
      jumpTo: d.commitCount - 1,
      focusPath: top.path,
    });
  }

  // 7. The peak number of files.
  facts.push({
    id: 'peak-files',
    kind: 'Biggest it ever was',
    text:
      `The repository held ${peakAlive.toLocaleString()} files at its largest, ` +
      `in ${month(d.time[peakAliveAt] ?? 0)}.`,
    jumpTo: peakAliveAt,
  });

  // 8. Where it started.
  facts.push({
    id: 'first-commit',
    kind: 'The first commit',
    text:
      `It began on ${date(d.time[0] ?? 0)}, when ${name(d.author[0]!)} committed ` +
      `“${(d.subjects[0] ?? '').slice(0, 60)}”.`,
    jumpTo: 0,
  });

  // 9. The busiest week, straight off the streamgraph.
  if (timeline.peakWeek > 0) {
    let week = 0;
    for (let w = 0; w < timeline.weeks; w++) {
      let total = 0;
      for (let s = 0; s < 8; s++) total += timeline.series[s * timeline.weeks + w]!;
      if (total === timeline.peakWeek) {
        week = w;
        break;
      }
    }
    const when = timeline.weekStart + week * 7 * DAY;
    let jump = 0;
    for (let k = 0; k < d.commitCount; k++) {
      if (d.time[k]! >= when) {
        jump = k;
        break;
      }
    }
    facts.push({
      id: 'peak-week',
      kind: 'Busiest week',
      // The weekly series leaves bots out, exactly as the streamgraph does.
      text:
        `The busiest single week saw ${timeline.peakWeek} commits, bots aside, ` +
        `starting ${date(when)}.`,
      jumpTo: jump,
    });
  }

  return facts;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function date(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function month(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Fuzzy path search: every character of the query must appear in order. Runs
 * of adjacent matches and a match on the file name score higher.
 */
export function searchPaths(
  d: Dataset,
  state: FileState,
  query: string,
  limit: number,
): { fileId: number; path: string; score: number }[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const out: { fileId: number; path: string; score: number }[] = [];

  for (let f = 0; f < d.fileCount; f++) {
    if (state.alive[f] === 0) continue;
    const path = d.paths[state.pathIndex[f]!]!;
    const lower = path.toLowerCase();
    let qi = 0;
    let score = 0;
    let run = 0;
    let lastHit = -2;
    for (let i = 0; i < lower.length && qi < q.length; i++) {
      if (lower[i] === q[qi]) {
        run = i === lastHit + 1 ? run + 1 : 1;
        score += run;
        lastHit = i;
        qi++;
      }
    }
    if (qi < q.length) continue;
    // A hit inside the file name beats one buried in a directory.
    const slash = lower.lastIndexOf('/');
    if (lastHit > slash) score += 8;
    if (lower.slice(slash + 1).startsWith(q)) score += 16;
    out.push({ fileId: f, path, score });
  }

  out.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  return out.slice(0, limit);
}

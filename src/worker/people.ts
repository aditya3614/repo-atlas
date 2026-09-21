import type { Dataset } from './model';
import { TYPE_NAMES, type FileIndex } from './fileIndex';
import type {
  AuthorCommit,
  AuthorProfile,
  CommitFile,
  PersonHit,
} from '../lib/protocol';

/**
 * Everything the "search for a person" feature knows: finding someone by name
 * or email, and then reading their whole history out of the columnar model.
 *
 * All of it is derived from commit metadata already in memory — no file
 * contents exist to read — and each function is one pass over that person's
 * commits, so a profile is cheap even for a busy author of a large history.
 */

const DAY = 86_400_000;
const ACTIVITY_BUCKETS = 48;

/** Fuzzy match over name and email, best first. Bots are findable too. */
export function searchPeople(d: Dataset, query: string, limit: number): PersonHit[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const out: PersonHit[] = [];

  for (let a = 0; a < d.authors.names.length; a++) {
    const name = d.authors.names[a]!;
    const email = d.authors.emails[a]!;
    const lname = name.toLowerCase();

    let score = 0;
    if (lname === q) score = 100;
    else if (lname.startsWith(q)) score = 70;
    else if (lname.split(/[\s._-]+/).some((w) => w.startsWith(q))) score = 55;
    else if (lname.includes(q)) score = 40;
    else if (email.startsWith(q)) score = 45;
    else if (email.includes(q)) score = 25;
    else if (subsequence(lname, q)) score = 8;
    if (score === 0) continue;

    out.push({
      id: a,
      name,
      email,
      commits: d.authors.commits[a]!,
      bot: d.authors.bot[a] === 1,
      score,
    });
  }

  // Among equally good matches the busier person is the likelier answer.
  out.sort((x, y) => y.score - x.score || y.commits - x.commits);
  return out.slice(0, limit);
}

function subsequence(hay: string, needle: string): boolean {
  let qi = 0;
  for (let i = 0; i < hay.length && qi < needle.length; i++) if (hay[i] === needle[qi]) qi++;
  return qi === needle.length;
}

/** Local calendar day as a whole number, so consecutive days differ by one. */
function dayNumber(ms: number): number {
  const t = new Date(ms);
  return Math.floor(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / DAY);
}

function commitRow(d: Dataset, k: number): AuthorCommit {
  let adds = 0;
  let dels = 0;
  for (let i = d.offsets[k]!; i < d.offsets[k + 1]!; i++) {
    adds += d.adds[i]!;
    dels += d.dels[i]!;
  }
  return {
    commit: k,
    subject: d.subjects[k] ?? '',
    time: d.rawTime[k]!,
    files: d.offsets[k + 1]! - d.offsets[k]!,
    adds,
    dels,
  };
}

/** One person's commits, newest first, a page at a time. */
export function authorCommits(
  d: Dataset,
  author: number,
  before: number,
  limit: number,
): { commits: AuthorCommit[]; more: boolean } {
  const commits: AuthorCommit[] = [];
  let k = Math.min(before, d.commitCount) - 1;
  for (; k >= 0 && commits.length < limit; k--) {
    if (d.author[k] === author) commits.push(commitRow(d, k));
  }
  let more = false;
  for (; k >= 0; k--) {
    if (d.author[k] === author) {
      more = true;
      break;
    }
  }
  return { commits, more };
}

/** The files one commit changed, under the names they had at the time. */
export function commitFiles(
  d: Dataset,
  commit: number,
  limit: number,
): { files: CommitFile[]; total: number } {
  const start = d.offsets[commit]!;
  const end = d.offsets[commit + 1]!;
  const files: CommitFile[] = [];
  for (let i = start; i < end && files.length < limit; i++) {
    const f = d.fileIds[i]!;
    files.push({
      fileId: f,
      path: d.paths[d.changePath[i]!] ?? '',
      adds: d.adds[i]!,
      dels: d.dels[i]!,
      binary: d.files.binary[f] === 1,
    });
  }
  // The biggest changes first: that is what someone scanning a commit wants.
  files.sort((a, b) => b.adds + b.dels - (a.adds + a.dels));
  return { files, total: end - start };
}

export function profileOf(
  d: Dataset,
  index: FileIndex,
  author: number,
  recentLimit: number,
): AuthorProfile {
  const n = d.commitCount;
  const repoFirst = d.rawTime.reduce((m, t) => Math.min(m, t), Infinity);
  const repoLast = d.rawTime.reduce((m, t) => Math.max(m, t), -Infinity);
  const spanMs = Math.max(1, repoLast - repoFirst);

  let commits = 0;
  let adds = 0;
  let dels = 0;
  let firstK = -1;
  let lastK = -1;

  const perDay = new Map<number, { count: number; first: number }>();
  const activity = new Uint32Array(ACTIVITY_BUCKETS);
  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  const kinds = new Array<number>(TYPE_NAMES.length).fill(0);
  const folders = new Map<string, number>();
  const files = new Map<
    number,
    { commits: number; adds: number; dels: number; lastK: number; path: number }
  >();

  let totalAdds = 0;
  let totalDels = 0;
  for (let i = 0; i < d.adds.length; i++) {
    totalAdds += d.adds[i]!;
    totalDels += d.dels[i]!;
  }

  for (let k = 0; k < n; k++) {
    if (d.author[k] !== author) continue;
    commits++;
    const t = d.rawTime[k]!;
    if (firstK < 0 || t < d.rawTime[firstK]!) firstK = k;
    if (lastK < 0 || t >= d.rawTime[lastK]!) lastK = k;

    const day = dayNumber(t);
    const slot = perDay.get(day);
    if (slot) slot.count++;
    else perDay.set(day, { count: 1, first: k });
    weekdays[new Date(t).getDay()]!++;
    const bucket = Math.min(
      ACTIVITY_BUCKETS - 1,
      Math.max(0, Math.floor(((t - repoFirst) / spanMs) * ACTIVITY_BUCKETS)),
    );
    activity[bucket]!++;

    for (let i = d.offsets[k]!; i < d.offsets[k + 1]!; i++) {
      const f = d.fileIds[i]!;
      const a = d.adds[i]!;
      const del = d.dels[i]!;
      adds += a;
      dels += del;

      let row = files.get(f);
      if (!row) {
        row = { commits: 0, adds: 0, dels: 0, lastK: k, path: d.changePath[i]! };
        files.set(f, row);
      }
      row.commits++;
      row.adds += a;
      row.dels += del;
      row.lastK = k;
      row.path = d.changePath[i]!;

      kinds[index.pathType[d.changePath[i]!]!]!++;
      const path = d.paths[d.changePath[i]!] ?? '';
      const top = path.includes('/') ? path.slice(0, path.indexOf('/')) : '(root)';
      folders.set(top, (folders.get(top) ?? 0) + 1);
    }
  }

  // Busiest day, and the longest run of consecutive days with a commit.
  let busiest = { time: 0, commits: 0, commit: -1 };
  const days = [...perDay.keys()].sort((a, b) => a - b);
  let streak = 0;
  let longest = 0;
  for (let i = 0; i < days.length; i++) {
    const info = perDay.get(days[i]!)!;
    if (info.count > busiest.commits) busiest = { time: d.rawTime[info.first]!, commits: info.count, commit: info.first };
    streak = i > 0 && days[i]! === days[i - 1]! + 1 ? streak + 1 : 1;
    if (streak > longest) longest = streak;
  }

  // Rank among everyone, by commits.
  let rank = 1;
  for (let a = 0; a < d.authors.commits.length; a++) {
    if (d.authors.commits[a]! > d.authors.commits[author]!) rank++;
  }

  let owns = 0;
  for (const f of files.keys()) if (index.dominantAuthor[f] === author) owns++;

  const topFiles = [...files.entries()]
    .sort((x, y) => y[1].adds + y[1].dels - (x[1].adds + x[1].dels))
    .slice(0, 8)
    .map(([fileId, r]) => ({
      fileId,
      path: d.paths[r.path] ?? '',
      commits: r.commits,
      adds: r.adds,
      dels: r.dels,
      last: d.rawTime[r.lastK]!,
    }));

  const topFolders = [...folders.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 6)
    .map(([path, touches]) => ({ path, touches }));

  const first = firstK >= 0 ? firstK : 0;
  const last = lastK >= 0 ? lastK : 0;
  const recent = authorCommits(d, author, n, recentLimit);
  const spanDays = commits > 0 ? Math.round((d.rawTime[last]! - d.rawTime[first]!) / DAY) + 1 : 0;

  return {
    id: author,
    name: d.authors.names[author]!,
    email: d.authors.emails[author]!,
    bot: d.authors.bot[author] === 1,
    commits,
    commitShare: n > 0 ? commits / n : 0,
    rank,
    people: d.authors.names.length,
    adds,
    dels,
    addShare: totalAdds > 0 ? adds / totalAdds : 0,
    delShare: totalDels > 0 ? dels / totalDels : 0,
    filesTouched: files.size,
    filesTotal: d.fileCount,
    owns,
    first: { commit: first, time: d.rawTime[first]!, subject: d.subjects[first] ?? '' },
    last: { commit: last, time: d.rawTime[last]!, subject: d.subjects[last] ?? '' },
    spanDays,
    activeDays: perDay.size,
    busiest,
    longestStreak: longest,
    activity,
    activityFrom: repoFirst,
    activityTo: repoLast,
    weekdays,
    kinds,
    topFiles,
    topFolders,
    recent: recent.commits,
    moreRecent: recent.more,
    fileIds: Uint32Array.from(files.keys()),
  };
}

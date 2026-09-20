import { GrowF64, GrowU32 } from './growable';
import { BINARY_WEIGHT, type Change, type CommitHead, type ParseSink } from './parse';

/**
 * Columnar model of a history. One typed array per field, never one object per
 * change: a 100k-commit history is ~500k changes, and objects for those would
 * cost more than the whole budget.
 */

const BOT = /\[bot\]|dependabot|renovate|github-actions/i;
const DAY = 86_400_000;
const MIN_TAU = 7 * DAY;

export interface Authors {
  /** Display name: the spelling this address used most often. */
  names: string[];
  emails: string[];
  commits: Uint32Array;
  adds: Float64Array;
  bot: Uint8Array;
}

export interface Files {
  /** Path the file was first seen at; the live path lives in the replay state. */
  firstPath: Uint32Array;
  firstCommit: Uint32Array;
  firstAuthor: Uint32Array;
  commitCount: Uint32Array;
  adds: Float64Array;
  dels: Float64Array;
  binary: Uint8Array;
}

export class Dataset {
  constructor(
    /** Author date in ms, forced to be non-decreasing (rebases reorder dates). */
    readonly time: Float64Array,
    /** The date git actually recorded, for display. */
    readonly rawTime: Float64Array,
    readonly author: Uint32Array,
    readonly subjects: string[],
    /** CSR: changes of commit k are [offsets[k], offsets[k+1]). */
    readonly offsets: Uint32Array,
    readonly fileIds: Uint32Array,
    readonly adds: Int32Array,
    readonly dels: Int32Array,
    /** Path each change left the file at, which makes renames free to replay. */
    readonly changePath: Uint32Array,
    readonly paths: string[],
    readonly files: Files,
    readonly authors: Authors,
  ) {}

  get commitCount(): number {
    return this.subjects.length;
  }
  get fileCount(): number {
    return this.files.firstPath.length;
  }

  /**
   * Bytes held by this dataset: exact for the typed arrays, and estimated for
   * the string tables at two bytes per character plus per-object overhead.
   * Reported in the UI rather than guessed at, since the worker's heap is not
   * visible to performance.memory on the main thread.
   */
  footprint(): number {
    let bytes =
      this.time.byteLength +
      this.rawTime.byteLength +
      this.author.byteLength +
      this.offsets.byteLength +
      this.fileIds.byteLength +
      this.adds.byteLength +
      this.dels.byteLength +
      this.changePath.byteLength +
      this.files.firstPath.byteLength +
      this.files.firstCommit.byteLength +
      this.files.firstAuthor.byteLength +
      this.files.commitCount.byteLength +
      this.files.adds.byteLength +
      this.files.dels.byteLength +
      this.files.binary.byteLength;
    for (const s of this.subjects) bytes += s.length * 2 + 16;
    for (const s of this.paths) bytes += s.length * 2 + 16;
    return bytes;
  }

  /** Heat half-life: 5% of the timeline, but never less than a week. */
  get tau(): number {
    const span = (this.time[this.time.length - 1] ?? 0) - (this.time[0] ?? 0);
    return Math.max(MIN_TAU, span * 0.05);
  }
}

export class ModelBuilder implements ParseSink {
  private time = new GrowF64(4096);
  private rawTime = new GrowF64(4096);
  private authorOf = new GrowU32(4096);
  private subjects: string[] = [];
  private offsets = new GrowU32(4096);

  private fileIds = new GrowU32(8192);
  private addsCol = new GrowU32(8192);
  private delsCol = new GrowU32(8192);
  private changePath = new GrowU32(8192);

  private paths: string[] = [];
  private pathIndex = new Map<string, number>();
  /** Live path -> fileId. A rename moves the key and keeps the id. */
  private fileOfPath = new Map<string, number>();

  private fFirstPath = new GrowU32(2048);
  private fFirstCommit = new GrowU32(2048);
  private fFirstAuthor = new GrowU32(2048);
  private fCommits = new GrowU32(2048);
  private fBinary: number[] = [];
  /** Per-file lifetime totals, grown alongside the file ids. */
  private fAddsAcc = new GrowF64(2048);
  private fDelsAcc = new GrowF64(2048);

  private authorIndex = new Map<string, number>();
  private authorNames: Map<string, number>[] = [];
  private authorEmails: string[] = [];
  private authorCommits = new GrowU32(64);
  private authorAddsAcc = new GrowF64(64);

  private maxTime = -Infinity;
  private changeCount = 0;

  /** Live file count, for the progress readout. */
  get fileCountSoFar(): number {
    return this.fFirstPath.length;
  }

  /** Biggest single commit by lines touched, kept for the story facts. */
  biggestCommit = { index: -1, lines: 0 };
  private currentLines = 0;

  commit(head: CommitHead): void {
    if (this.biggestCommit.index >= 0 || this.subjects.length > 0) this.flushCommitStats();

    const t = head.time;
    this.rawTime.push(t);
    // Non-monotonic author dates are normal after a rebase. Sequencing follows
    // git's order; the time axis uses a running maximum so it never goes back.
    if (t > this.maxTime) this.maxTime = t;
    this.time.push(this.maxTime);

    this.authorOf.push(this.authorFor(head.name, head.email));
    this.subjects.push(head.subject);
    this.offsets.push(this.changeCount);
    this.currentLines = 0;
  }

  private flushCommitStats(): void {
    const idx = this.subjects.length - 1;
    if (idx >= 0 && this.currentLines > this.biggestCommit.lines) {
      this.biggestCommit = { index: idx, lines: this.currentLines };
    }
  }

  private authorFor(name: string, email: string): number {
    const key = email.trim().toLowerCase();
    let id = this.authorIndex.get(key);
    if (id === undefined) {
      id = this.authorEmails.length;
      this.authorIndex.set(key, id);
      this.authorEmails.push(key);
      this.authorNames.push(new Map());
      this.authorCommits.push(0);
      this.authorAddsAcc.push(0);
    }
    const names = this.authorNames[id]!;
    names.set(name, (names.get(name) ?? 0) + 1);
    this.authorCommits.set(id, this.authorCommits.get(id) + 1);
    return id;
  }

  private internPath(p: string): number {
    let i = this.pathIndex.get(p);
    if (i === undefined) {
      i = this.paths.length;
      this.paths.push(p);
      this.pathIndex.set(p, i);
    }
    return i;
  }

  change(c: Change): void {
    const commitIdx = this.subjects.length - 1;
    if (commitIdx < 0) return;

    let fileId: number | undefined;
    if (c.from !== null) {
      fileId = this.fileOfPath.get(c.from);
      // An unknown old path means the history is shallow or truncated: the
      // brief says treat it as a new file rather than guessing.
      if (fileId !== undefined) this.fileOfPath.delete(c.from);
    }
    if (fileId === undefined) fileId = this.fileOfPath.get(c.path);

    const pathIdx = this.internPath(c.path);

    if (fileId === undefined) {
      fileId = this.fFirstPath.length;
      this.fFirstPath.push(pathIdx);
      this.fFirstCommit.push(commitIdx);
      this.fFirstAuthor.push(this.authorOf.get(commitIdx));
      this.fCommits.push(0);
      this.fAddsAcc.push(0);
      this.fDelsAcc.push(0);
      this.fBinary.push(c.binary ? 1 : 0);
    } else if (c.binary) {
      this.fBinary[fileId] = 1;
    }
    this.fileOfPath.set(c.path, fileId);

    this.fCommits.set(fileId, this.fCommits.get(fileId) + 1);

    this.fileIds.push(fileId);
    this.addsCol.push(c.adds);
    this.delsCol.push(c.dels);
    this.changePath.push(pathIdx);
    this.changeCount++;

    // A binary file has no line counts, so it is weighed as a constant.
    const addWeight = c.binary ? BINARY_WEIGHT : c.adds;
    const delWeight = c.binary ? 0 : c.dels;
    this.currentLines += addWeight + delWeight;
    this.authorAddsAcc.add(this.authorOf.get(commitIdx), addWeight);
    this.fAddsAcc.add(fileId, addWeight);
    this.fDelsAcc.add(fileId, delWeight);
  }

  finish(): Dataset {
    this.flushCommitStats();

    const n = this.subjects.length;
    const offsets = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++) offsets[i] = this.offsets.get(i);
    offsets[n] = this.changeCount;

    const fileCount = this.fFirstPath.length;
    const fAdds = new Float64Array(fileCount);
    const fDels = new Float64Array(fileCount);
    for (let i = 0; i < fileCount; i++) {
      fAdds[i] = this.fAddsAcc.get(i);
      fDels[i] = this.fDelsAcc.get(i);
    }

    const authorCount = this.authorEmails.length;
    const names: string[] = [];
    const bot = new Uint8Array(authorCount);
    const aAdds = new Float64Array(authorCount);
    for (let i = 0; i < authorCount; i++) {
      let best = '';
      let bestN = -1;
      for (const [name, count] of this.authorNames[i]!) {
        if (count > bestN) {
          best = name;
          bestN = count;
        }
      }
      names.push(best);
      const email = this.authorEmails[i]!;
      bot[i] = BOT.test(best) || BOT.test(email) ? 1 : 0;
      aAdds[i] = this.authorAddsAcc.get(i);
    }

    const adds = new Int32Array(this.changeCount);
    const dels = new Int32Array(this.changeCount);
    for (let i = 0; i < this.changeCount; i++) {
      adds[i] = this.addsCol.get(i);
      dels[i] = this.delsCol.get(i);
    }

    return new Dataset(
      this.time.trimmed(),
      this.rawTime.trimmed(),
      this.authorOf.trimmed(),
      this.subjects,
      offsets,
      this.fileIds.trimmed(),
      adds,
      dels,
      this.changePath.trimmed(),
      this.paths,
      {
        firstPath: this.fFirstPath.trimmed(),
        firstCommit: this.fFirstCommit.trimmed(),
        firstAuthor: this.fFirstAuthor.trimmed(),
        commitCount: this.fCommits.trimmed(),
        adds: fAdds,
        dels: fDels,
        binary: Uint8Array.from(this.fBinary),
      },
      {
        names,
        emails: this.authorEmails,
        commits: this.authorCommits.trimmed(),
        adds: aAdds,
        bot,
      },
    );
  }
}

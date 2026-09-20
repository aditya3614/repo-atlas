import { BINARY_WEIGHT } from './parse';
import type { Dataset } from './model';

/**
 * The state of every file at one commit, and the checkpoint index that makes
 * getting there cheap.
 *
 * Scrubbing must never replay from the start, so the full state is snapshotted
 * periodically and any commit is reached by restoring the nearest snapshot at
 * or before it and replaying forward.
 */

export interface FileState {
  size: Int32Array;
  alive: Uint8Array;
  pathIndex: Uint32Array;
  /** Also the heat reference time: heat is only ever updated on a touch. */
  lastTouch: Float64Array;
  heat: Float32Array;
  /** Commit index this state describes, or -1 for "before the first commit". */
  commit: number;
  aliveCount: number;
}

function makeState(fileCount: number): FileState {
  return {
    size: new Int32Array(fileCount),
    alive: new Uint8Array(fileCount),
    pathIndex: new Uint32Array(fileCount),
    lastTouch: new Float64Array(fileCount),
    heat: new Float32Array(fileCount),
    commit: -1,
    aliveCount: 0,
  };
}

function copyInto(dst: FileState, src: FileState): void {
  dst.size.set(src.size);
  dst.alive.set(src.alive);
  dst.pathIndex.set(src.pathIndex);
  dst.lastTouch.set(src.lastTouch);
  dst.heat.set(src.heat);
  dst.commit = src.commit;
  dst.aliveCount = src.aliveCount;
}

/** Bytes one snapshot costs per file: 4 + 1 + 4 + 8 + 4. */
const BYTES_PER_FILE = 21;
/** Checkpoints are an index, not the data; keep them well inside the budget. */
const CHECKPOINT_BUDGET = 48 * 1024 * 1024;
const DEFAULT_INTERVAL = 256;

/**
 * Apply one commit to a state in place. Both the checkpoint build and every
 * scrub go through here, so there is exactly one definition of "the state at
 * commit k".
 */
export function applyCommit(d: Dataset, s: FileState, k: number): void {
  const t = d.time[k]!;
  const tau = d.tau;
  const start = d.offsets[k]!;
  const end = d.offsets[k + 1]!;

  for (let i = start; i < end; i++) {
    const f = d.fileIds[i]!;
    const adds = d.adds[i]!;
    const dels = d.dels[i]!;
    const binary = d.files.binary[f] === 1;

    if (s.alive[f] === 0) {
      s.alive[f] = 1;
      s.aliveCount++;
      s.size[f] = binary ? BINARY_WEIGHT : adds;
    } else if (!binary) {
      const next = s.size[f]! + adds - dels;
      s.size[f] = next > 0 ? next : 0;
    }

    // A deletion shows up as "every line removed". Binary files carry no line
    // counts, so their removal is invisible in numstat and they stay on the map.
    if (!binary && dels > 0 && s.size[f] === 0) {
      s.alive[f] = 0;
      s.aliveCount--;
    }

    s.pathIndex[f] = d.changePath[i]!;

    // heat = decayed previous heat + 1, sampled at the touch.
    const prev = s.heat[f]!;
    const last = s.lastTouch[f]!;
    s.heat[f] = (last === 0 ? 0 : prev * Math.exp(-(t - last) / tau)) + 1;
    s.lastTouch[f] = t;
  }

  s.commit = k;
}

export class Checkpoints {
  readonly interval: number;
  private readonly snaps: FileState[] = [];
  /** Reused by every restore, so scrubbing allocates nothing. */
  private readonly scratch: FileState;

  constructor(private readonly d: Dataset) {
    const fileCount = d.fileCount;
    const perSnap = Math.max(1, fileCount * BYTES_PER_FILE);
    const affordable = Math.max(1, Math.floor(CHECKPOINT_BUDGET / perSnap));
    const needed = Math.ceil(d.commitCount / DEFAULT_INTERVAL);
    // 256 as the brief asks, widened only when that many snapshots would not
    // fit the memory budget (20k files x 100k commits would cost ~230 MB).
    let interval = DEFAULT_INTERVAL;
    if (needed > affordable) {
      interval = 1 << Math.ceil(Math.log2(d.commitCount / affordable));
    }
    this.interval = interval;
    this.scratch = makeState(fileCount);

    const running = makeState(fileCount);
    let peak = 0;
    for (let k = 0; k < d.commitCount; k++) {
      if (k % interval === 0) {
        const snap = makeState(fileCount);
        copyInto(snap, running);
        this.snaps.push(snap);
      }
      applyCommit(d, running, k);
      if (running.aliveCount > peak) {
        peak = running.aliveCount;
        this.peakAliveAt = k;
      }
    }
    this.peakAlive = peak;
  }

  /** Most files alive at once, and when — a story fact, measured for free here. */
  peakAlive = 0;
  peakAliveAt = 0;

  get count(): number {
    return this.snaps.length;
  }

  /** Exact bytes held by the checkpoint index. */
  footprint(): number {
    const per = this.d.fileCount * BYTES_PER_FILE;
    return (this.snaps.length + 1) * per;
  }

  /** State after commits 0..k inclusive. k = -1 gives the empty state. */
  stateAt(k: number): FileState {
    const s = this.scratch;
    if (k < 0) {
      copyInto(s, this.snaps[0] ?? makeState(this.d.fileCount));
      s.commit = -1;
      return s;
    }
    const idx = Math.min(this.snaps.length - 1, Math.floor(k / this.interval));
    copyInto(s, this.snaps[idx]!);
    for (let i = idx * this.interval; i <= k; i++) applyCommit(this.d, s, i);
    return s;
  }
}

/** Heat as seen at time `now`, which is what the map colours by. */
export function heatAt(s: FileState, f: number, now: number, tau: number): number {
  const last = s.lastTouch[f]!;
  if (last === 0) return 0;
  return s.heat[f]! * Math.exp(-(now - last) / tau);
}

export { makeState };

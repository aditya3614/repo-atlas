import type { Dataset } from './model';

/**
 * Files that change in the same commit.
 *
 * Counting every pair in every commit is quadratic in the commit's size, so a
 * sweeping refactor that touches 400 files would alone cost 80,000 pairs and
 * say nothing — "these all moved at once" is not a relationship. Commits above
 * MAX_FANOUT are skipped, and only files that actually churn are considered.
 */

const MAX_FANOUT = 20;
const CANDIDATES = 600;

export interface CoChange {
  /** Pairs of file ids, flattened: a0, b0, a1, b1, … */
  pairs: Uint32Array;
  /** How many commits each pair shared. */
  counts: Uint32Array;
  /** Commits counted, for the honest caption. */
  commitsConsidered: number;
  maxCount: number;
}

export function buildCoChange(d: Dataset, limit: number): CoChange {
  // Only the busiest files can form a meaningful pair, and limiting the
  // candidate set keeps the pair map bounded whatever the repository size.
  const byChurn = [...Array(d.fileCount).keys()].sort(
    (a, b) => d.files.commitCount[b]! - d.files.commitCount[a]!,
  );
  const rank = new Int32Array(d.fileCount).fill(-1);
  const take = Math.min(CANDIDATES, byChurn.length);
  for (let i = 0; i < take; i++) rank[byChurn[i]!] = i;

  const counts = new Map<number, number>();
  const scratch: number[] = [];
  let commitsConsidered = 0;

  for (let k = 0; k < d.commitCount; k++) {
    const start = d.offsets[k]!;
    const end = d.offsets[k + 1]!;
    if (end - start < 2 || end - start > MAX_FANOUT) continue;

    scratch.length = 0;
    for (let i = start; i < end; i++) {
      const r = rank[d.fileIds[i]!]!;
      if (r >= 0) scratch.push(r);
    }
    if (scratch.length < 2) continue;
    commitsConsidered++;

    scratch.sort((a, b) => a - b);
    for (let i = 0; i < scratch.length; i++) {
      for (let j = i + 1; j < scratch.length; j++) {
        const key = scratch[i]! * CANDIDATES + scratch[j]!;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }

  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  const pairs = new Uint32Array(entries.length * 2);
  const out = new Uint32Array(entries.length);
  let maxCount = 0;
  for (let i = 0; i < entries.length; i++) {
    const [key, count] = entries[i]!;
    pairs[i * 2] = byChurn[Math.floor(key / CANDIDATES)]!;
    pairs[i * 2 + 1] = byChurn[key % CANDIDATES]!;
    out[i] = count;
    if (count > maxCount) maxCount = count;
  }

  return { pairs, counts: out, commitsConsidered, maxCount };
}

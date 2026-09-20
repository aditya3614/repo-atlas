import type { Dataset } from './model';

/**
 * Everything time-shaped that the dock needs: the streamgraph's weekly bins,
 * and the two playback timelines.
 *
 * Playback maps a position in [0, total] to a commit index. There are two
 * mappings: real time, and one where a gap longer than the cap counts as the
 * cap, so a three-year hiatus does not leave the map frozen for half the show.
 */

const WEEK = 7 * 86_400_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Series shown in the streamgraph: seven authors plus everyone else. */
export const TOP_AUTHORS = 7;
export const SERIES = TOP_AUTHORS + 1;

export interface Timeline {
  times: Float64Array;
  /** Cumulative playback position per commit; length commits + 1. */
  cumReal: Float64Array;
  cumSkip: Float64Array;
  totalReal: number;
  totalSkip: number;
  /** Gap length beyond which time is compressed, in ms. */
  quietCap: number;
  quietGaps: number;
  weekStart: number;
  weeks: number;
  /** Row-major [series][week] commit counts. */
  series: Uint32Array;
  /** Author id per series; the last entry is -1, meaning "everyone else". */
  seriesAuthors: Int32Array;
  /** Busiest week, for the story facts and for scaling the graph. */
  peakWeek: number;
}

export function buildTimeline(d: Dataset, includeBots: boolean): Timeline {
  const n = d.commitCount;
  const times = d.time;

  // --- playback mapping -------------------------------------------------
  const gaps: number[] = [];
  for (let k = 1; k < n; k++) {
    const g = times[k]! - times[k - 1]!;
    if (g > 0) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  const median = gaps.length > 0 ? gaps[gaps.length >> 1]! : HOUR;
  // Twelve typical gaps still reads as "a pause"; beyond that it is dead air.
  const quietCap = Math.max(HOUR, Math.min(3 * DAY, median * 12));

  const cumReal = new Float64Array(n + 1);
  const cumSkip = new Float64Array(n + 1);
  let quietGaps = 0;
  for (let k = 1; k < n; k++) {
    const g = Math.max(0, times[k]! - times[k - 1]!);
    cumReal[k] = cumReal[k - 1]! + g;
    const capped = Math.min(g, quietCap);
    if (g > quietCap) quietGaps++;
    cumSkip[k] = cumSkip[k - 1]! + capped;
  }
  // One extra step so the last commit is on screen before playback ends.
  cumReal[n] = cumReal[n - 1]! + quietCap;
  cumSkip[n] = cumSkip[n - 1]! + quietCap;

  // --- streamgraph bins -------------------------------------------------
  const first = times[0] ?? 0;
  const last = times[n - 1] ?? first;
  const weekStart = Math.floor(first / WEEK) * WEEK;
  const weeks = Math.max(1, Math.ceil((last - weekStart) / WEEK) + 1);

  const authorCount = d.authors.names.length;
  const commitsBy = new Float64Array(authorCount);
  for (let a = 0; a < authorCount; a++) {
    if (!includeBots && d.authors.bot[a] === 1) continue;
    commitsBy[a] = d.authors.commits[a]!;
  }
  const ranked = [...commitsBy.keys()].sort((a, b) => commitsBy[b]! - commitsBy[a]!);
  const seriesAuthors = new Int32Array(SERIES).fill(-1);
  const slotOf = new Int32Array(authorCount).fill(TOP_AUTHORS);
  for (let i = 0; i < TOP_AUTHORS && i < ranked.length; i++) {
    const a = ranked[i]!;
    if (commitsBy[a]! === 0) break;
    seriesAuthors[i] = a;
    slotOf[a] = i;
  }

  const series = new Uint32Array(SERIES * weeks);
  for (let k = 0; k < n; k++) {
    const a = d.author[k]!;
    if (!includeBots && d.authors.bot[a] === 1) continue;
    const w = Math.min(weeks - 1, Math.max(0, Math.floor((times[k]! - weekStart) / WEEK)));
    series[slotOf[a]! * weeks + w]!++;
  }

  let peakWeek = 0;
  for (let w = 0; w < weeks; w++) {
    let total = 0;
    for (let s = 0; s < SERIES; s++) total += series[s * weeks + w]!;
    if (total > peakWeek) peakWeek = total;
  }

  return {
    times,
    cumReal,
    cumSkip,
    totalReal: cumReal[n]!,
    totalSkip: cumSkip[n]!,
    quietCap,
    quietGaps,
    weekStart,
    weeks,
    series,
    seriesAuthors,
    peakWeek,
  };
}

/** Commit index at a playback position, by binary search over the cumulative. */
export function commitAt(cum: Float64Array, pos: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  if (pos <= 0) return 0;
  if (pos >= cum[hi]!) return hi - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >>> 1;
    if (cum[mid]! <= pos) lo = mid;
    else hi = mid;
  }
  return lo;
}

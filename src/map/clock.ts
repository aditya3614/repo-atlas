import type { TimelinePayload } from '../lib/protocol';
import { commitAt } from '../worker/timeline';

/**
 * Playback state.
 *
 * A plain mutable object on purpose: the animation loop reads it every frame,
 * and routing that through React state would re-render the tree sixty times a
 * second. React subscribes separately, and is told at a few frames a second —
 * enough for a clock readout, far too slow to drive the map.
 */

export const SPEEDS = [0.5, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

/** At 1x the whole history plays in this long. */
const FULL_PLAY_MS = 45_000;

export interface ClockState {
  timeline: TimelinePayload | null;
  /** Position along the active timeline, in its own milliseconds. */
  pos: number;
  commit: number;
  playing: boolean;
  speed: Speed;
  skipQuiet: boolean;
  /** True while the playhead is being dragged, which suppresses tweening. */
  scrubbing: boolean;
  commits: number;
}

export const clock: ClockState = {
  timeline: null,
  pos: 0,
  commit: 0,
  playing: false,
  speed: 1,
  skipQuiet: true,
  scrubbing: false,
  commits: 0,
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeClock(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Called at a few Hz, never per frame. */
export function notifyClock(): void {
  for (const fn of listeners) fn();
}

function activeCum(): Float64Array | null {
  const t = clock.timeline;
  if (!t) return null;
  return clock.skipQuiet ? t.cumSkip : t.cumReal;
}

export function total(): number {
  const t = clock.timeline;
  if (!t) return 1;
  return (clock.skipQuiet ? t.totalSkip : t.totalReal) || 1;
}

export function setTimeline(t: TimelinePayload, commits: number): void {
  clock.timeline = t;
  clock.commits = commits;
  clock.commit = commits - 1;
  clock.pos = total();
  notifyClock();
}

/** Advance playback by a real-time delta. Returns true if the commit moved. */
export function advance(dtMs: number): boolean {
  const cum = activeCum();
  if (!cum || !clock.playing) return false;
  const before = clock.commit;
  clock.pos += (dtMs / FULL_PLAY_MS) * total() * clock.speed;
  if (clock.pos >= total()) {
    clock.pos = total();
    clock.playing = false;
    notifyClock();
  }
  clock.commit = commitAt(cum, clock.pos);
  return clock.commit !== before;
}

export function seekToCommit(k: number): void {
  const cum = activeCum();
  const max = Math.max(0, clock.commits - 1);
  clock.commit = k < 0 ? 0 : k > max ? max : k;
  if (cum) clock.pos = cum[clock.commit]!;
}

export function seekToFraction(f: number): void {
  const cum = activeCum();
  if (!cum) return;
  clock.pos = Math.max(0, Math.min(1, f)) * total();
  clock.commit = commitAt(cum, clock.pos);
}

/** Where the playhead sits, 0..1, for drawing. */
export function fraction(): number {
  return clock.pos / total();
}

/** Fraction of a given commit along the active timeline. */
export function fractionOfCommit(k: number): number {
  const cum = activeCum();
  if (!cum) return 0;
  return (cum[Math.max(0, Math.min(cum.length - 1, k))] ?? 0) / total();
}

export function toggleQuiet(on: boolean): void {
  // Keep the same commit on screen when the timeline underneath changes.
  const k = clock.commit;
  clock.skipQuiet = on;
  seekToCommit(k);
  notifyClock();
}

export function currentTime(): number {
  const t = clock.timeline;
  if (!t) return 0;
  return t.times[Math.max(0, Math.min(t.times.length - 1, clock.commit))] ?? 0;
}

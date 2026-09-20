/** Types shared by the main thread and the worker. */

export interface InputError {
  title: string;
  detail?: string;
  /** 1-based line number in the input, when we know it. */
  line?: number;
  offending?: string;
  hint: string;
}

export interface AuthorSummary {
  name: string;
  email: string;
  commits: number;
  /** Lines added over the whole history; binaries count as a constant. */
  adds: number;
  bot: boolean;
}

export interface Summary {
  /** Taken from the dropped file's name, or the demo's repo name. */
  repo: string;
  bytes: number;
  commits: number;
  files: number;
  authors: number;
  botCommits: number;
  firstTime: number;
  lastTime: number;
  /** Most files alive at once, and the commit where that happened. */
  peakAlive: number;
  peakAliveAt: number;
  biggestCommit: { index: number; lines: number; subject: string; time: number };
  topAuthors: AuthorSummary[];
  /** How the history is indexed, surfaced in the UI's "how it works". */
  checkpointInterval: number;
  checkpoints: number;
  /** Bytes the parsed history occupies in the worker; see Dataset.footprint. */
  indexBytes: number;
  parseMs: number;
  attribution?: { repo: string; url: string; license: string };
}

export interface Progress {
  commits: number;
  files: number;
  bytes: number;
  totalBytes: number;
}

export type Weighting = 'balanced' | 'linear';

export interface LayoutRequest {
  /** Echoed back, so a stale reply can be dropped. */
  id: number;
  commit: number;
  width: number;
  height: number;
  root: string;
  weighting: Weighting;
}

/** One frame's worth of geometry and per-cell attributes. */
export interface LayoutPayload {
  id: number;
  commit: number;
  root: string;
  width: number;
  height: number;
  rects: Float32Array;
  fileIds: Uint32Array;
  pathIds: Uint32Array;
  size: Int32Array;
  heat: Float32Array;
  lastTouch: Float64Array;
  commits: Uint32Array;
  author: Uint32Array;
  type: Uint8Array;
  firstTime: Float64Array;
  churn: Float32Array;
  folderRects: Float32Array;
  folderDepth: Uint8Array;
  folderNames: string[];
  folderPaths: string[];
  hiddenCount: number;
  aliveCount: number;
  /** Worker-side milliseconds, for the performance pass. */
  tookMs: number;
}

/** Sent once when a history finishes loading; the map needs it to draw. */
export interface Tables {
  paths: string[];
  authorNames: string[];
  authorEmails: string[];
  authorBot: Uint8Array;
  /** Palette slot per author id: 0-9 for the ten biggest, 10 for the rest. */
  authorSlot: Uint8Array;
  binaryWeight: number;
  /** Largest lifetime churn in the history, so the churn ramp is stable. */
  maxChurn: number;
}

export interface TimelinePayload {
  times: Float64Array;
  cumReal: Float64Array;
  cumSkip: Float64Array;
  totalReal: number;
  totalSkip: number;
  quietCap: number;
  quietGaps: number;
  weekStart: number;
  weeks: number;
  series: Uint32Array;
  seriesAuthors: Int32Array;
  peakWeek: number;
}

export interface CoChangePayload {
  pairs: Uint32Array;
  counts: Uint32Array;
  commitsConsidered: number;
  maxCount: number;
}

/** Commit subjects for the ticker, fetched a window at a time. */
export interface SubjectWindow {
  from: number;
  subjects: string[];
  authors: Uint32Array;
}

export interface Sparkline {
  fileId: number;
  values: Float32Array;
}

export type ToWorker =
  | { type: 'parse'; blob: Blob; repo: string; gzip: boolean; attribution?: Summary['attribution'] }
  | { type: 'cancel' }
  | { type: 'layout'; request: LayoutRequest }
  | { type: 'sparkline'; fileId: number; samples: number }
  | { type: 'timeline'; includeBots: boolean }
  | { type: 'cochange'; limit: number }
  | { type: 'subjects'; from: number; count: number };

export type FromWorker =
  | { type: 'progress'; progress: Progress }
  | { type: 'done'; summary: Summary; tables: Tables }
  | { type: 'error'; error: InputError }
  | { type: 'cancelled' }
  | { type: 'layout'; layout: LayoutPayload }
  | { type: 'sparkline'; sparkline: Sparkline }
  | { type: 'timeline'; timeline: TimelinePayload }
  | { type: 'cochange'; cochange: CoChangePayload }
  | { type: 'subjects'; window: SubjectWindow };

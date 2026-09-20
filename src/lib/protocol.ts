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

export type ToWorker =
  | { type: 'parse'; blob: Blob; repo: string; gzip: boolean; attribution?: Summary['attribution'] }
  | { type: 'cancel' };

export type FromWorker =
  | { type: 'progress'; progress: Progress }
  | { type: 'done'; summary: Summary }
  | { type: 'error'; error: InputError }
  | { type: 'cancelled' };

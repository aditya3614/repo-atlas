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

export interface LayoutRequest {
  /** Echoed back, so a stale reply can be dropped. */
  id: number;
  commit: number;
  width: number;
  height: number;
  root: string;
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

/** Commit subjects for the ticker, fetched a window at a time. */
export interface SubjectWindow {
  from: number;
  subjects: string[];
  authors: Uint32Array;
}

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
  jumpTo: number;
  focusPath?: string;
}

export interface MeaningPayload {
  commit: number;
  hotspots: Hotspot[];
  windowDays: number;
  singleOwner: FolderOwnership[];
  /** Every sizeable folder, for the table view. */
  folders: FolderOwnership[];
  facts: StoryFact[];
}

export interface SearchHit {
  fileId: number;
  path: string;
  score: number;
}

/** A person the search box matched, by name or email. */
export interface PersonHit {
  id: number;
  name: string;
  email: string;
  commits: number;
  bot: boolean;
  score: number;
}

/** One commit in a person's history. Times are the date git recorded. */
export interface AuthorCommit {
  commit: number;
  subject: string;
  time: number;
  files: number;
  adds: number;
  dels: number;
}

/** A file one commit changed, under the name it had at that moment. */
export interface CommitFile {
  fileId: number;
  path: string;
  adds: number;
  dels: number;
  binary: boolean;
}

/** Everything the Person tab shows: one author, read out of the whole history. */
export interface AuthorProfile {
  id: number;
  name: string;
  email: string;
  bot: boolean;
  commits: number;
  /** Fractions of the whole repository, 0 to 1. */
  commitShare: number;
  /** 1 is the busiest committer, out of `people`. */
  rank: number;
  people: number;
  adds: number;
  dels: number;
  addShare: number;
  delShare: number;
  filesTouched: number;
  filesTotal: number;
  /** Files where this person added the most lines. */
  owns: number;
  first: { commit: number; time: number; subject: string };
  last: { commit: number; time: number; subject: string };
  spanDays: number;
  activeDays: number;
  busiest: { time: number; commits: number; commit: number };
  longestStreak: number;
  /** Commits per slice of the repository's whole life, oldest first. */
  activity: Uint32Array;
  activityFrom: number;
  activityTo: number;
  /** Commits by day of the week, Sunday first. */
  weekdays: number[];
  /** Files touched by kind, in TYPE_NAMES order. */
  kinds: number[];
  topFiles: { fileId: number; path: string; commits: number; adds: number; dels: number; last: number }[];
  topFolders: { path: string; touches: number }[];
  recent: AuthorCommit[];
  moreRecent: boolean;
  /** Every file this person has ever touched, so the map can light them up. */
  fileIds: Uint32Array;
}

/** Everything the Selection tab shows about one file. */
export interface FileDetail {
  fileId: number;
  path: string;
  size: number;
  commits: number;
  firstTime: number;
  lastTouch: number;
  createdBy: string;
  type: number;
  /** Lines added per author, biggest first. */
  authors: { name: string; email: string; adds: number; bot: boolean }[];
  /** The five commits that changed this file most. */
  biggest: { commit: number; subject: string; lines: number; time: number }[];
  busFactor: number;
  folder: string;
  history: Float32Array;
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
  | { type: 'subjects'; from: number; count: number }
  | { type: 'meaning'; commit: number }
  | { type: 'search'; query: string; commit: number; limit: number }
  | { type: 'profile'; author: number }
  | { type: 'authorCommits'; author: number; before: number; limit: number }
  | { type: 'commitFiles'; commit: number }
  | { type: 'detail'; fileId: number; commit: number };

export type FromWorker =
  | { type: 'progress'; progress: Progress }
  | { type: 'done'; summary: Summary; tables: Tables }
  | { type: 'error'; error: InputError }
  | { type: 'cancelled' }
  | { type: 'layout'; layout: LayoutPayload }
  | { type: 'sparkline'; sparkline: Sparkline }
  | { type: 'timeline'; timeline: TimelinePayload }
  | { type: 'subjects'; window: SubjectWindow }
  | { type: 'meaning'; meaning: MeaningPayload }
  | { type: 'search'; query: string; hits: SearchHit[]; people: PersonHit[] }
  | { type: 'profile'; profile: AuthorProfile }
  | { type: 'authorCommits'; author: number; commits: AuthorCommit[]; more: boolean }
  | { type: 'commitFiles'; commit: number; files: CommitFile[]; total: number }
  | { type: 'detail'; detail: FileDetail };

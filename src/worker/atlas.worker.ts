/// <reference lib="webworker" />
import { ChunkSplitter, LineParser, ParseError, BINARY_WEIGHT } from './parse';
import { ModelBuilder, type Dataset } from './model';
import { Checkpoints } from './state';
import { FileIndex } from './fileIndex';
import { computeLayout, transferables } from './layout';
import { buildTimeline } from './timeline';
import { folderTable, hotspots, ownership, searchPaths, singleOwner, storyFacts } from './meaning';
import { authorCommits, commitFiles, profileOf, searchPeople } from './people';
import type { FromWorker, InputError, Progress, Summary, Tables, ToWorker } from '../lib/protocol';

/**
 * Parsing, indexing and (from M2) layout all happen here, so a 100 MB file
 * never blocks the UI. The dataset itself stays in the worker: the main thread
 * gets a summary now and typed-array rectangles later.
 */

const HUGE_BYTES = 120 * 1024 * 1024;
const PROGRESS_MS = 100;
/** How many of a person's commits the profile carries before "show more". */
const RECENT_PAGE = 25;

let cancelled = false;

/** Kept across messages so M2 can lay out without re-parsing. */
export interface Loaded {
  dataset: Dataset;
  checkpoints: Checkpoints;
  index: FileIndex;
  summary: Summary;
}
let loaded: Loaded | null = null;
let timeline: ReturnType<typeof buildTimeline> | null = null;

const post = (m: FromWorker, transfer?: Transferable[]) =>
  (self as unknown as Worker).postMessage(m, transfer ?? []);

function toInputError(e: unknown): InputError {
  if (e instanceof ParseError) {
    return { title: e.message, line: e.line, offending: e.offending, hint: e.hint };
  }
  return {
    title: 'Something went wrong while reading this file',
    detail: e instanceof Error ? e.message : String(e),
    hint: 'Re-run the command and try the file again. If it keeps failing, the file may be truncated.',
  };
}

async function parse(msg: Extract<ToWorker, { type: 'parse' }>): Promise<void> {
  const started = performance.now();
  const { blob } = msg;

  if (blob.size === 0) {
    post({
      type: 'error',
      error: {
        title: 'That file is empty',
        hint: 'Re-run the command in your repository’s root — it writes atlas.txt into the current directory.',
      },
    });
    return;
  }
  if (blob.size > HUGE_BYTES) {
    post({
      type: 'error',
      error: {
        title: 'That history is very large',
        detail: `${(blob.size / (1024 * 1024)).toFixed(0)} MB is more than a browser tab should hold at once.`,
        hint: 'Narrow it with --since="2 years ago", or limit it to a path: git log … -- src/',
      },
    });
    return;
  }

  const builder = new ModelBuilder();
  const parser = new LineParser(builder);
  const splitter = new ChunkSplitter(parser);

  let bytes = 0;
  let lastPost = 0;
  const progress: Progress = { commits: 0, files: 0, bytes: 0, totalBytes: blob.size };

  let stream: ReadableStream<Uint8Array> = blob.stream();
  if (msg.gzip) {
    // lib.dom types DecompressionStream's writable side as BufferSource, which
    // does not line up with ReadableStream<Uint8Array>; the pairing is valid.
    stream = stream.pipeThrough(
      new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
    );
  }
  const reader = stream
    .pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>)
    .getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (cancelled) {
        await reader.cancel();
        post({ type: 'cancelled' });
        return;
      }
      // Bytes read is approximated from the decoded text when the input is
      // gzipped, since the compressed position is not observable.
      bytes += value.length;
      splitter.push(value);

      const now = performance.now();
      if (now - lastPost > PROGRESS_MS) {
        lastPost = now;
        progress.commits = parser.commits;
        progress.files = builder.fileCountSoFar;
        progress.bytes = msg.gzip ? Math.min(blob.size, bytes / 3) : bytes;
        post({ type: 'progress', progress });
      }
    }
    splitter.end();
  } catch (e) {
    post({ type: 'error', error: toInputError(e) });
    return;
  }

  const dataset = builder.finish();
  if (dataset.commitCount === 0) {
    post({
      type: 'error',
      error: {
        title: 'No commits found',
        detail: 'The file is in the right format, but it contains no commit records.',
        hint: 'If you used --since or a path filter, widen it: that range may simply have no commits.',
      },
    });
    return;
  }

  const checkpoints = new Checkpoints(dataset);
  const parseMs = performance.now() - started;

  const order = [...dataset.authors.names.keys()]
    .filter((i) => dataset.authors.bot[i] === 0)
    .sort((a, b) => dataset.authors.commits[b]! - dataset.authors.commits[a]!);

  let botCommits = 0;
  for (let i = 0; i < dataset.authors.bot.length; i++) {
    if (dataset.authors.bot[i] === 1) botCommits += dataset.authors.commits[i]!;
  }

  const big = builder.biggestCommit;
  const summary: Summary = {
    repo: msg.repo,
    bytes: blob.size,
    commits: dataset.commitCount,
    files: dataset.fileCount,
    authors: dataset.authors.names.length,
    botCommits,
    firstTime: dataset.time[0]!,
    lastTime: dataset.time[dataset.commitCount - 1]!,
    peakAlive: checkpoints.peakAlive,
    peakAliveAt: checkpoints.peakAliveAt,
    biggestCommit: {
      index: big.index,
      lines: big.lines,
      subject: dataset.subjects[big.index] ?? '',
      time: dataset.time[big.index] ?? 0,
    },
    topAuthors: order.slice(0, 8).map((i) => ({
      name: dataset.authors.names[i]!,
      email: dataset.authors.emails[i]!,
      commits: dataset.authors.commits[i]!,
      adds: dataset.authors.adds[i]!,
      bot: false,
    })),
    checkpointInterval: checkpoints.interval,
    checkpoints: checkpoints.count,
    indexBytes: dataset.footprint() + checkpoints.footprint(),
    parseMs,
    ...(msg.attribution ? { attribution: msg.attribution } : {}),
  };

  const index = new FileIndex(dataset);
  loaded = { dataset, checkpoints, index, summary };

  const authorSlot = new Uint8Array(dataset.authors.names.length);
  for (let a = 0; a < authorSlot.length; a++) {
    authorSlot[a] = Math.min(10, index.authorRank[a]!);
  }
  const tables: Tables = {
    paths: dataset.paths,
    authorNames: dataset.authors.names,
    authorEmails: dataset.authors.emails,
    authorBot: dataset.authors.bot,
    authorSlot,
    binaryWeight: BINARY_WEIGHT,
  };
  post({ type: 'done', summary, tables });
}

/** Everything the Selection tab needs about one file, in one reply. */
function detailOf(fileId: number, commit: number) {
  const { dataset: d, checkpoints: cp, index } = loaded!;
  const at = Math.max(0, Math.min(d.commitCount - 1, commit));
  const state = cp.stateAt(at);
  const path = d.paths[state.pathIndex[fileId]!] ?? d.paths[d.files.firstPath[fileId]!]!;

  const start = index.fileOffsets[fileId]!;
  const end = index.fileOffsets[fileId + 1]!;

  const byAuthor = new Map<number, number>();
  const commits: { commit: number; subject: string; lines: number; time: number }[] = [];
  for (let j = start; j < end; j++) {
    const i = index.fileChanges[j]!;
    const k = index.changeCommit[i]!;
    if (k > at) break;
    const a = d.author[k]!;
    byAuthor.set(a, (byAuthor.get(a) ?? 0) + d.adds[i]!);
    commits.push({
      commit: k,
      subject: d.subjects[k] ?? '',
      lines: d.adds[i]! + d.dels[i]!,
      time: d.time[k]!,
    });
  }
  commits.sort((x, y) => y.lines - x.lines);

  const authors = [...byAuthor.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([a, adds]) => ({
      name: d.authors.names[a]!,
      email: d.authors.emails[a]!,
      adds,
      bot: d.authors.bot[a] === 1,
    }));

  // Bus factor for the file's own folder, which is what the chip reports.
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const own = folder === '' ? null : ownership(d, state, at).get(folder) ?? null;

  return {
    fileId,
    path,
    size: state.size[fileId]!,
    commits: end - start,
    firstTime: d.time[d.files.firstCommit[fileId]!] ?? 0,
    lastTouch: state.lastTouch[fileId]!,
    createdBy: d.authors.names[d.files.firstAuthor[fileId]!] ?? 'unknown',
    type: index.pathType[state.pathIndex[fileId]!]!,
    authors: authors.slice(0, 8),
    biggest: commits.slice(0, 5),
    busFactor: own?.busFactor ?? 0,
    folder,
    history: index.sizeHistory(fileId, BINARY_WEIGHT, 96),
  };
}

function layout(request: Extract<ToWorker, { type: 'layout' }>['request']): void {
  if (!loaded) return;
  const started = performance.now();
  const state = loaded.checkpoints.stateAt(request.commit);
  const result = computeLayout(loaded.dataset, loaded.index, state, request);
  const payload = { ...result, id: request.id, tookMs: performance.now() - started };
  post({ type: 'layout', layout: payload }, transferables(result));
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (msg.type === 'parse') {
    cancelled = false;
    loaded = null;
    timeline = null;
    void parse(msg);
    return;
  }
  if (msg.type === 'layout') {
    layout(msg.request);
    return;
  }
  if (msg.type === 'sparkline') {
    if (!loaded) return;
    const values = loaded.index.sizeHistory(msg.fileId, BINARY_WEIGHT, msg.samples);
    post({ type: 'sparkline', sparkline: { fileId: msg.fileId, values } }, [values.buffer]);
    return;
  }
  if (msg.type === 'timeline') {
    if (!loaded) return;
    const t = buildTimeline(loaded.dataset, msg.includeBots);
    if (!msg.includeBots) timeline = t;
    // `times` belongs to the dataset and must not be transferred away.
    post({ type: 'timeline', timeline: { ...t, times: t.times.slice() } });
    return;
  }
  if (msg.type === 'meaning') {
    if (!loaded) return;
    const { dataset: d, checkpoints: cp, index } = loaded;
    const commit = Math.max(0, Math.min(d.commitCount - 1, msg.commit));
    const state = cp.stateAt(commit);
    const own = ownership(d, state, commit);
    const spots = hotspots(d, state, commit, 20);
    timeline ??= buildTimeline(d, false);
    post({
      type: 'meaning',
      meaning: {
        commit,
        hotspots: spots.list,
        windowDays: spots.windowDays,
        singleOwner: singleOwner(own, 12),
        folders: folderTable(own, 200),
        facts: storyFacts(d, index, state, timeline, own, cp.peakAlive, cp.peakAliveAt),
      },
    });
    return;
  }
  if (msg.type === 'search') {
    if (!loaded) return;
    const state = loaded.checkpoints.stateAt(msg.commit);
    post({
      type: 'search',
      query: msg.query,
      hits: searchPaths(loaded.dataset, state, msg.query, msg.limit),
      people: searchPeople(loaded.dataset, msg.query, 6),
    });
    return;
  }
  if (msg.type === 'profile') {
    if (!loaded) return;
    post({
      type: 'profile',
      profile: profileOf(loaded.dataset, loaded.index, msg.author, RECENT_PAGE),
    });
    return;
  }
  if (msg.type === 'authorCommits') {
    if (!loaded) return;
    const page = authorCommits(loaded.dataset, msg.author, msg.before, msg.limit);
    post({ type: 'authorCommits', author: msg.author, ...page });
    return;
  }
  if (msg.type === 'commitFiles') {
    if (!loaded) return;
    const k = Math.max(0, Math.min(loaded.dataset.commitCount - 1, msg.commit));
    post({ type: 'commitFiles', commit: k, ...commitFiles(loaded.dataset, k, 80) });
    return;
  }
  if (msg.type === 'detail') {
    if (!loaded) return;
    post({ type: 'detail', detail: detailOf(msg.fileId, msg.commit) });
    return;
  }
  if (msg.type === 'subjects') {
    if (!loaded) return;
    const d = loaded.dataset;
    const from = Math.max(0, Math.min(d.commitCount - 1, msg.from));
    const to = Math.min(d.commitCount, from + msg.count);
    const authors = new Uint32Array(to - from);
    for (let k = from; k < to; k++) authors[k - from] = d.author[k]!;
    post({
      type: 'subjects',
      window: { from, subjects: d.subjects.slice(from, to), authors },
    });
  }
};

/** Exposed for the layout work in M2, which runs in this same worker. */
export function current(): Loaded | null {
  return loaded;
}

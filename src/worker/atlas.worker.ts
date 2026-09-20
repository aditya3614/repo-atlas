/// <reference lib="webworker" />
import { ChunkSplitter, LineParser, ParseError, BINARY_WEIGHT } from './parse';
import { ModelBuilder, type Dataset } from './model';
import { Checkpoints } from './state';
import { FileIndex } from './fileIndex';
import { computeLayout, transferables } from './layout';
import { buildTimeline } from './timeline';
import { buildCoChange } from './cochange';
import type { FromWorker, InputError, Progress, Summary, Tables, ToWorker } from '../lib/protocol';

/**
 * Parsing, indexing and (from M2) layout all happen here, so a 100 MB file
 * never blocks the UI. The dataset itself stays in the worker: the main thread
 * gets a summary now and typed-array rectangles later.
 */

const HUGE_BYTES = 120 * 1024 * 1024;
const PROGRESS_MS = 100;

let cancelled = false;

/** Kept across messages so M2 can lay out without re-parsing. */
export interface Loaded {
  dataset: Dataset;
  checkpoints: Checkpoints;
  index: FileIndex;
  summary: Summary;
}
let loaded: Loaded | null = null;
/** Co-change is expensive and never changes, so it is built once on demand. */
let cochange: ReturnType<typeof buildCoChange> | null = null;

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
    maxChurn: maxChurn(dataset),
  };
  post({ type: 'done', summary, tables });
}

function maxChurn(d: Dataset): number {
  let max = 0;
  for (let f = 0; f < d.fileCount; f++) {
    const c = d.files.adds[f]! + d.files.dels[f]!;
    if (c > max) max = c;
  }
  return max;
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
    cochange = null;
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
    // `times` belongs to the dataset and must not be transferred away.
    post({ type: 'timeline', timeline: { ...t, times: t.times.slice() } });
    return;
  }
  if (msg.type === 'cochange') {
    if (!loaded) return;
    cochange ??= buildCoChange(loaded.dataset, msg.limit);
    post({
      type: 'cochange',
      cochange: {
        pairs: cochange.pairs.slice(),
        counts: cochange.counts.slice(),
        commitsConsidered: cochange.commitsConsidered,
        maxCount: cochange.maxCount,
      },
    });
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

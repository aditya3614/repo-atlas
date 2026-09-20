/// <reference lib="webworker" />
import { ChunkSplitter, LineParser, ParseError } from './parse';
import { ModelBuilder, type Dataset } from './model';
import { Checkpoints } from './state';
import type { FromWorker, InputError, Progress, Summary, ToWorker } from '../lib/protocol';

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
  summary: Summary;
}
let loaded: Loaded | null = null;

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

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

  loaded = { dataset, checkpoints, summary };
  post({ type: 'done', summary });
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
    void parse(msg);
  }
};

/** Exposed for the layout work in M2, which runs in this same worker. */
export function current(): Loaded | null {
  return loaded;
}

import type { Dataset } from './model';

/**
 * Per-file indexes that the map needs but the build pass does not produce:
 * which changes belong to a file, who wrote most of it, and what kind of file
 * it is. All of it is derived once, on demand, and then cached.
 */

export const TYPE = { code: 0, tests: 1, docs: 2, config: 3, assets: 4 } as const;
export type TypeId = (typeof TYPE)[keyof typeof TYPE];
export const TYPE_NAMES = ['Code', 'Tests', 'Docs', 'Config', 'Assets'] as const;

const TESTS = /(^|\/)(tests?|specs?|__tests__|e2e|cypress)(\/|$)|\.(test|spec)\.[a-z]+$/i;
const DOCS = /\.(md|mdx|rst|adoc|txt)$|(^|\/)(docs?|documentation)(\/)/i;
const CONFIG =
  /\.(json|ya?ml|toml|ini|cfg|conf|lock|properties|editorconfig|gitignore|npmrc|nvmrc)$|(^|\/)\.[a-z]+rc$|\.config\.[a-z]+$|(^|\/)(dockerfile|makefile)$/i;
const ASSETS = /\.(png|jpe?g|gif|svg|webp|avif|ico|icns|woff2?|ttf|eot|otf|mp[34]|webm|mov|pdf|zip|gz)$/i;

export function classify(path: string): TypeId {
  if (TESTS.test(path)) return TYPE.tests;
  if (ASSETS.test(path)) return TYPE.assets;
  if (DOCS.test(path)) return TYPE.docs;
  if (CONFIG.test(path)) return TYPE.config;
  return TYPE.code;
}

export class FileIndex {
  /** Changes of file f are fileChanges[fileOffsets[f] .. fileOffsets[f+1]). */
  readonly fileOffsets: Uint32Array;
  readonly fileChanges: Uint32Array;
  /** Author who added the most lines to each file. */
  readonly dominantAuthor: Uint32Array;
  /** Type per *path*, not per file: a file moved into test/ becomes a test. */
  readonly pathType: Uint8Array;
  /** Rank of each author by lines added, so the palette is stable. */
  readonly authorRank: Uint32Array;
  /** Commit each change belongs to; the CSR fill already knows it. */
  readonly changeCommit: Uint32Array;

  constructor(private readonly d: Dataset) {
    const fileCount = d.fileCount;
    const changeCount = d.fileIds.length;

    // CSR of changes per file: count, prefix sum, fill.
    const offsets = new Uint32Array(fileCount + 1);
    for (let i = 0; i < changeCount; i++) offsets[d.fileIds[i]! + 1]!++;
    for (let f = 0; f < fileCount; f++) offsets[f + 1]! += offsets[f]!;
    const changes = new Uint32Array(changeCount);
    const changeCommit = new Uint32Array(changeCount);
    const cursor = offsets.slice(0, fileCount);
    for (let k = 0; k < d.commitCount; k++) {
      const start = d.offsets[k]!;
      const end = d.offsets[k + 1]!;
      for (let i = start; i < end; i++) {
        changeCommit[i] = k;
        changes[cursor[d.fileIds[i]!]!++] = i;
      }
    }
    this.fileOffsets = offsets;
    this.fileChanges = changes;
    this.changeCommit = changeCommit;

    // Dominant author per file. Tallies live in one scratch array that is
    // cleared through a dirty list, so this stays O(changes).
    const authorCount = d.authors.names.length;
    const tally = new Float64Array(authorCount);
    const dirty = new Uint32Array(authorCount);
    const dominant = new Uint32Array(fileCount);
    for (let f = 0; f < fileCount; f++) {
      let dirtyN = 0;
      let best = 0;
      let bestLines = -1;
      for (let j = offsets[f]!; j < offsets[f + 1]!; j++) {
        const i = changes[j]!;
        const a = d.author[changeCommit[i]!]!;
        if (tally[a] === 0) dirty[dirtyN++] = a;
        const lines = d.adds[i]! + 1; // +1 so a touch always counts for something
        tally[a]! += lines;
        if (tally[a]! > bestLines) {
          bestLines = tally[a]!;
          best = a;
        }
      }
      dominant[f] = best;
      for (let j = 0; j < dirtyN; j++) tally[dirty[j]!] = 0;
    }
    this.dominantAuthor = dominant;

    const pathType = new Uint8Array(d.paths.length);
    for (let p = 0; p < d.paths.length; p++) pathType[p] = classify(d.paths[p]!);
    this.pathType = pathType;

    const rank = new Uint32Array(authorCount);
    const order = [...Array(authorCount).keys()].sort(
      (a, b) => d.authors.adds[b]! - d.authors.adds[a]!,
    );
    for (let i = 0; i < order.length; i++) rank[order[i]!] = i;
    this.authorRank = rank;
  }

  /** Size of one file over its own changes, for sparklines. */
  sizeHistory(f: number, binaryWeight: number, samples: number): Float32Array {
    const start = this.fileOffsets[f]!;
    const end = this.fileOffsets[f + 1]!;
    const n = end - start;
    const out = new Float32Array(Math.min(samples, Math.max(1, n)));
    const binary = this.d.files.binary[f] === 1;
    let size = 0;
    for (let j = 0; j < n; j++) {
      const i = this.fileChanges[start + j]!;
      if (binary) size = binaryWeight;
      else if (j === 0) size = this.d.adds[i]!;
      else size = Math.max(0, size + this.d.adds[i]! - this.d.dels[i]!);
      const slot = out.length === 1 ? 0 : Math.floor((j / Math.max(1, n - 1)) * (out.length - 1));
      out[slot] = size;
    }
    // Fill any sample slots that no change landed in.
    for (let j = 1; j < out.length; j++) if (out[j] === 0 && out[j - 1]! > 0) out[j] = out[j - 1]!;
    return out;
  }
}

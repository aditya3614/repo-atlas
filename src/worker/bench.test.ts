import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { ChunkSplitter, LineParser } from './parse';
import { ModelBuilder } from './model';
import { Checkpoints } from './state';

const PATH = '.cache/synthetic.txt';

describe.skipIf(!existsSync(PATH))('synthetic benchmark', () => {
  it('parses and indexes the 100k-commit dataset', () => {
    const text = readFileSync(PATH, 'utf8');
    const t0 = performance.now();
    const b = new ModelBuilder();
    const s = new ChunkSplitter(new LineParser(b));
    for (let i = 0; i < text.length; i += 1 << 16) s.push(text.slice(i, i + (1 << 16)));
    s.end();
    const d = b.finish();
    const t1 = performance.now();
    const cp = new Checkpoints(d);
    const t2 = performance.now();

    console.log(
      `node: ${(text.length / 1e6).toFixed(1)} MB | parse ${(t1 - t0).toFixed(0)}ms | ` +
        `index ${(t2 - t1).toFixed(0)}ms | ${d.commitCount} commits, ${d.fileCount} files, ` +
        `${d.fileIds.length} changes | interval ${cp.interval}, ${cp.count} checkpoints | ` +
        `footprint ${((d.footprint() + cp.footprint()) / 1e6).toFixed(0)} MB`,
    );
    expect(d.commitCount).toBe(100_000);
    expect(d.fileCount).toBeGreaterThan(15_000);
  }, 120_000);
});

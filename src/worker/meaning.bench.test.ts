import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { ChunkSplitter, LineParser } from './parse';
import { ModelBuilder } from './model';
import { Checkpoints } from './state';
import { FileIndex } from './fileIndex';
import { buildTimeline } from './timeline';
import { hotspots, ownership, singleOwner, storyFacts } from './meaning';

const PATH = '.cache/synthetic.txt';

describe.skipIf(!existsSync(PATH))('meaning cost on the synthetic history', () => {
  it('breaks down where the time goes', () => {
    const text = readFileSync(PATH, 'utf8');
    const b = new ModelBuilder();
    const s = new ChunkSplitter(new LineParser(b));
    s.push(text);
    s.end();
    const d = b.finish();
    const cp = new Checkpoints(d);
    const index = new FileIndex(d);
    const k = d.commitCount - 1;
    const state = cp.stateAt(k);

    const t0 = performance.now();
    const own = ownership(d, state, k);
    const t1 = performance.now();
    const spots = hotspots(d, state, k, 20);
    const t2 = performance.now();
    const tl = buildTimeline(d, false);
    const t3 = performance.now();
    const facts = storyFacts(d, index, state, tl, own, cp.peakAlive, cp.peakAliveAt);
    const t4 = performance.now();

    console.log(
      `ownership ${(t1 - t0).toFixed(0)}ms | hotspots ${(t2 - t1).toFixed(0)}ms | ` +
        `timeline ${(t3 - t2).toFixed(0)}ms | facts ${(t4 - t3).toFixed(0)}ms | ` +
        `folders ${own.size}, solo ${singleOwner(own, 12).length}, facts ${facts.length}`,
    );
    expect(spots.list.length).toBeGreaterThan(0);
  }, 180_000);
});

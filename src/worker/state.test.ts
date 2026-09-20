import { describe, it, expect } from 'vitest';
import { generate, mulberry32 } from '../../scripts/synthetic.mjs';
import { ChunkSplitter, LineParser } from './parse';
import { ModelBuilder, type Dataset } from './model';
import { applyCommit, Checkpoints, heatAt, makeState } from './state';

function build(text: string): Dataset {
  const b = new ModelBuilder();
  const s = new ChunkSplitter(new LineParser(b));
  s.push(text);
  s.end();
  return b.finish();
}

/** The reference implementation: replay every commit from the very start. */
function fullReplay(d: Dataset, k: number) {
  const s = makeState(d.fileCount);
  for (let i = 0; i <= k; i++) applyCommit(d, s, i);
  return s;
}

describe('checkpoints', () => {
  const d = build(generate({ commits: 3000, files: 900, seed: 7 }));
  const cp = new Checkpoints(d);

  it('covers the whole history', () => {
    expect(d.commitCount).toBe(3000);
    expect(cp.count).toBe(Math.ceil(3000 / cp.interval));
  });

  it('restores exactly what a full replay produces, at random commits', () => {
    const rnd = mulberry32(99);
    for (let trial = 0; trial < 40; trial++) {
      const k = Math.floor(rnd() * d.commitCount);
      const restored = cp.stateAt(k);
      const replayed = fullReplay(d, k);
      expect(restored.commit, `commit ${k}`).toBe(k);
      expect(restored.aliveCount, `alive at ${k}`).toBe(replayed.aliveCount);
      expect(Array.from(restored.size), `size at ${k}`).toEqual(Array.from(replayed.size));
      expect(Array.from(restored.alive), `alive at ${k}`).toEqual(Array.from(replayed.alive));
      expect(Array.from(restored.pathIndex), `paths at ${k}`).toEqual(Array.from(replayed.pathIndex));
      expect(Array.from(restored.heat), `heat at ${k}`).toEqual(Array.from(replayed.heat));
    }
  });

  it('restores the boundaries as well as the middle', () => {
    for (const k of [0, 1, cp.interval - 1, cp.interval, cp.interval + 1, d.commitCount - 1]) {
      const restored = cp.stateAt(k);
      expect(Array.from(restored.size), `commit ${k}`).toEqual(Array.from(fullReplay(d, k).size));
    }
  });

  it('never replays more than one interval', () => {
    // A guard on the promise that scrubbing does not walk from the start.
    expect(cp.interval).toBeLessThanOrEqual(1024);
    expect(d.commitCount / cp.count).toBeLessThanOrEqual(cp.interval);
  });

  it('records the peak number of live files', () => {
    expect(cp.peakAlive).toBeGreaterThan(0);
    expect(cp.peakAlive).toBeGreaterThanOrEqual(cp.stateAt(d.commitCount - 1).aliveCount);
  });
});

describe('file lifecycle', () => {
  const head = (n: number, subject = 's') =>
    `@@@\nh${n}\nAda\na@b.c\n2020-01-${String(n).padStart(2, '0')}T00:00:00Z\n${subject}\n\n`;

  it('sets the first size from the adds, then adds and subtracts', () => {
    const d = build(
      head(1) + '10\t0\tsrc/a.ts\n' + head(2) + '5\t3\tsrc/a.ts\n' + head(3) + '0\t12\tsrc/a.ts\n',
    );
    const cp = new Checkpoints(d);
    expect(cp.stateAt(0).size[0]).toBe(10);
    expect(cp.stateAt(1).size[0]).toBe(12);
    expect(cp.stateAt(2).size[0]).toBe(0);
    expect(cp.stateAt(2).alive[0]).toBe(0);
  });

  it('never lets a size go below zero', () => {
    const d = build(head(1) + '3\t0\tsrc/a.ts\n' + head(2) + '0\t99\tsrc/a.ts\n');
    expect(new Checkpoints(d).stateAt(1).size[0]).toBe(0);
  });

  it('gives a binary file a constant weight and keeps it alive', () => {
    const d = build(head(1) + '-\t-\tlogo.png\n' + head(2) + '-\t-\tlogo.png\n');
    const cp = new Checkpoints(d);
    expect(cp.stateAt(0).size[0]).toBe(30);
    expect(cp.stateAt(1).size[0]).toBe(30);
    expect(cp.stateAt(1).alive[0]).toBe(1);
  });

  it('follows a rename with the path, not with a new file', () => {
    const d = build(head(1) + '4\t0\tsrc/a.ts\n' + head(2) + '1\t0\tsrc/{a.ts => b.ts}\n');
    const cp = new Checkpoints(d);
    expect(d.fileCount).toBe(1);
    expect(d.paths[cp.stateAt(0).pathIndex[0]!]).toBe('src/a.ts');
    expect(d.paths[cp.stateAt(1).pathIndex[0]!]).toBe('src/b.ts');
  });

  it('treats a rename from an unknown path as a new file', () => {
    const d = build(head(1) + '4\t0\tsrc/{ghost.ts => real.ts}\n');
    expect(d.fileCount).toBe(1);
    expect(d.paths[new Checkpoints(d).stateAt(0).pathIndex[0]!]).toBe('src/real.ts');
  });

  it('revives a file that is deleted and later added again', () => {
    const d = build(
      head(1) + '4\t0\tsrc/a.ts\n' + head(2) + '0\t4\tsrc/a.ts\n' + head(3) + '9\t0\tsrc/a.ts\n',
    );
    const cp = new Checkpoints(d);
    expect(d.fileCount).toBe(1);
    expect(cp.stateAt(1).alive[0]).toBe(0);
    expect(cp.stateAt(2).alive[0]).toBe(1);
    expect(cp.stateAt(2).size[0]).toBe(9);
  });
});

describe('heat', () => {
  const day = 86_400_000;
  const at = (n: number) => new Date(Date.UTC(2020, 0, 1) + n * day).toISOString();
  const commit = (n: number, rows: string) =>
    `@@@\nh${n}\nAda\na@b.c\n${at(n)}\ntouch\n\n${rows}`;

  it('adds one per touch and decays between touches', () => {
    // 400 days of history makes tau 20 days (5% of the span).
    const d = build(
      commit(0, '1\t0\tsrc/a.ts\n') + commit(20, '1\t0\tsrc/a.ts\n') + commit(400, '1\t0\tsrc/b.ts\n'),
    );
    const cp = new Checkpoints(d);
    expect(d.tau).toBeCloseTo(20 * day, 0);

    // First touch: heat is exactly 1.
    expect(cp.stateAt(0).heat[0]!).toBeCloseTo(1, 5);
    // Second touch one tau later: e^-1 + 1.
    expect(cp.stateAt(1).heat[0]!).toBeCloseTo(Math.exp(-1) + 1, 4);
  });

  it('keeps decaying after the last touch', () => {
    const d = build(commit(0, '1\t0\tsrc/a.ts\n') + commit(400, '1\t0\tsrc/b.ts\n'));
    const cp = new Checkpoints(d);
    const s = cp.stateAt(1);
    const now = d.time[1]!;
    const hot = heatAt(s, 0, now, d.tau);
    expect(hot).toBeCloseTo(Math.exp(-400 / 20), 6);
    expect(hot).toBeLessThan(heatAt(s, 1, now, d.tau));
  });

  it('is zero for a file that has never been touched', () => {
    const d = build(commit(0, '1\t0\tsrc/a.ts\n'));
    const s = makeState(2);
    expect(heatAt(s, 1, d.time[0]!, d.tau)).toBe(0);
  });
});

describe('edge-shaped histories', () => {
  const build2 = (t: string) => {
    const b = new ModelBuilder();
    const s = new ChunkSplitter(new LineParser(b));
    s.push(t);
    s.end();
    return b.finish();
  };

  it('handles a repository of one file and one commit', () => {
    const d = build2('@@@\nh\nAda\na@b.c\n2020-01-01T00:00:00Z\nonly\n\n7\t0\tREADME.md\n');
    const cp = new Checkpoints(d);
    expect(d.commitCount).toBe(1);
    expect(d.fileCount).toBe(1);
    expect(cp.stateAt(0).aliveCount).toBe(1);
    expect(cp.stateAt(0).size[0]).toBe(7);
  });

  it('handles a history that spans a single day', () => {
    let text = '';
    for (let i = 0; i < 12; i++) {
      const hh = String(i).padStart(2, '0');
      text += `@@@\nh${i}\nAda\na@b.c\n2020-03-04T${hh}:00:00Z\nc${i}\n\n3\t1\tsrc/a.ts\n`;
    }
    const d = build2(text);
    // tau has a floor of seven days, so a one-day history does not divide by ~0.
    expect(d.tau).toBe(7 * 86_400_000);
    expect(Number.isFinite(new Checkpoints(d).stateAt(11).heat[0]!)).toBe(true);
  });

  it('handles a commit that touches thousands of tiny files', () => {
    let rows = '';
    for (let i = 0; i < 3000; i++) rows += `1\t0\tassets/icons/i${i}.svg\n`;
    const d = build2(`@@@\nh\nAda\na@b.c\n2020-01-01T00:00:00Z\nbulk\n\n${rows}`);
    expect(d.fileCount).toBe(3000);
    expect(new Checkpoints(d).stateAt(0).aliveCount).toBe(3000);
  });
});

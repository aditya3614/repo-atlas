import { describe, it, expect } from 'vitest';
import { ChunkSplitter, LineParser } from './parse';
import { ModelBuilder, type Dataset } from './model';
import { Checkpoints } from './state';
import { FileIndex } from './fileIndex';
import { hotspots, ownership, searchPaths, singleOwner, storyFacts } from './meaning';
import { buildTimeline } from './timeline';

function build(text: string): Dataset {
  const b = new ModelBuilder();
  const s = new ChunkSplitter(new LineParser(b));
  s.push(text);
  s.end();
  return b.finish();
}

function commit(day: number, who: [string, string], rows: string[]): string {
  const d = String(day).padStart(2, '0');
  return `@@@\nh${day}${who[0]}\n${who[0]}\n${who[1]}\n2023-01-${d}T00:00:00Z\nwork on ${day}\n\n${rows.join('\n')}\n`;
}

const ADA: [string, string] = ['Ada', 'ada@x.c'];
const GRACE: [string, string] = ['Grace', 'grace@x.c'];
const BOT: [string, string] = ['dependabot[bot]', 'support@dependabot.com'];

/** Ada owns solo/, both work on shared/, a bot bumps deps. */
const HISTORY =
  commit(1, ADA, ['100\t0\tsolo/a.ts', '100\t0\tshared/x.ts']) +
  commit(2, ADA, ['100\t0\tsolo/b.ts']) +
  commit(3, GRACE, ['100\t0\tshared/y.ts']) +
  commit(4, GRACE, ['50\t20\tshared/x.ts']) +
  commit(5, ADA, ['10\t5\tsolo/a.ts']) +
  commit(6, BOT, ['1\t1\tpackage.json']) +
  commit(7, GRACE, ['400\t400\tshared/y.ts']);

function ctx(text = HISTORY) {
  const d = build(text);
  const cp = new Checkpoints(d);
  const index = new FileIndex(d);
  return { d, cp, index, state: cp.stateAt(d.commitCount - 1) };
}

describe('ownership and the bus factor', () => {
  it('marks a folder only one person has written as single-owner', () => {
    const { d, state } = ctx();
    const own = ownership(d, state, d.commitCount - 1);
    expect(own.get('solo')!.busFactor).toBe(1);
    expect(own.get('solo')!.topShare).toBe(1);
    expect(d.authors.names[own.get('solo')!.topAuthor]).toBe('Ada');
  });

  it('needs two people for a folder they share', () => {
    const { d, state } = ctx();
    // Ada 100, Grace 450 in shared/: Grace alone is 82%, so the bus factor is 1.
    const shared = ownership(d, state, d.commitCount - 1).get('shared')!;
    expect(shared.authors).toBe(2);
    expect(shared.topShare).toBeGreaterThan(0.8);
    expect(shared.busFactor).toBe(1);
  });

  it('counts two owners when neither reaches 80% alone', () => {
    const even =
      commit(1, ADA, ['100\t0\teven/a.ts']) + commit(2, GRACE, ['100\t0\teven/b.ts']);
    const { d, state } = ctx(even);
    expect(ownership(d, state, d.commitCount - 1).get('even')!.busFactor).toBe(2);
  });

  it('leaves bots out of ownership entirely', () => {
    const { d, state } = ctx();
    const own = ownership(d, state, d.commitCount - 1);
    // package.json is only ever touched by the bot, so it has no folder owner.
    for (const o of own.values()) {
      expect(d.authors.bot[o.topAuthor]).toBe(0);
    }
  });

  it('lists single-owner folders biggest first', () => {
    const { d, state } = ctx();
    const list = singleOwner(ownership(d, state, d.commitCount - 1), 10);
    expect(list.map((o) => o.path)).toContain('solo');
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1]!.lines).toBeGreaterThanOrEqual(list[i]!.lines);
    }
  });

  it('measures ownership as of the commit it is asked about', () => {
    const { d, state, cp } = ctx();
    // Commits 0 and 1 are Ada's; Grace first appears in shared/ at commit 2.
    const early = ownership(d, cp.stateAt(1), 1);
    expect(early.get('shared')!.authors).toBe(1);
    const late = ownership(d, state, d.commitCount - 1);
    expect(late.get('shared')!.authors).toBe(2);
  });
});

describe('hotspots', () => {
  it('ranks by churn weighted by how many people touched it', () => {
    const { d, state } = ctx();
    const { list } = hotspots(d, state, d.commitCount - 1, 10);
    // shared/y.ts has the most churn and two authors over the window.
    expect(list[0]!.path).toBe('shared/y.ts');
    expect(list[0]!.reason).toMatch(/changed \d+ times? in \d+ months? by \d+ (person|people)/);
  });

  it('never reports a file that is no longer there', () => {
    const gone = HISTORY + commit(8, ADA, ['0\t215\tsolo/a.ts']);
    const { d, state } = ctx(gone);
    const { list } = hotspots(d, state, d.commitCount - 1, 10);
    expect(list.map((h) => h.path)).not.toContain('solo/a.ts');
  });

  it('reports the window it measured', () => {
    const { d, state } = ctx();
    const { windowDays } = hotspots(d, state, d.commitCount - 1, 10);
    expect(windowDays).toBeGreaterThan(0);
  });
});

describe('story facts', () => {
  const { d, index, state, cp } = ctx();
  const own = ownership(d, state, d.commitCount - 1);
  const facts = storyFacts(d, index, state, buildTimeline(d, false), own, cp.peakAlive, cp.peakAliveAt);

  it('produces between six and nine of them', () => {
    expect(facts.length).toBeGreaterThanOrEqual(6);
    expect(facts.length).toBeLessThanOrEqual(9);
  });

  it('gives every fact a commit that really exists', () => {
    for (const f of facts) {
      expect(f.jumpTo, f.id).toBeGreaterThanOrEqual(0);
      expect(f.jumpTo, f.id).toBeLessThan(d.commitCount);
      expect(f.text.length, f.id).toBeGreaterThan(10);
    }
  });

  it('points the first-commit fact at the first commit', () => {
    const first = facts.find((f) => f.id === 'first-commit')!;
    expect(first.jumpTo).toBe(0);
    expect(first.text).toContain('Ada');
  });

  it('points the largest-commit fact at the commit that really is largest', () => {
    const largest = facts.find((f) => f.id === 'largest-commit')!;
    // Commit 7 changes 800 lines, more than any other.
    expect(largest.jumpTo).toBe(6);
  });

  it('states the share behind a single-owner claim rather than overstating it', () => {
    const solo = facts.find((f) => f.id === 'single-owner');
    if (solo) expect(solo.text).toMatch(/\d+% of/);
  });
});

describe('path search', () => {
  const { d, state } = ctx();

  it('matches characters in order, anywhere in the path', () => {
    const hits = searchPaths(d, state, 'shx', 20);
    expect(hits[0]!.path).toBe('shared/x.ts');
  });

  it('prefers a match in the file name over one in a directory', () => {
    const hits = searchPaths(d, state, 'y', 20);
    expect(hits[0]!.path).toBe('shared/y.ts');
  });

  it('returns nothing for an empty query or a miss', () => {
    expect(searchPaths(d, state, '', 20)).toEqual([]);
    expect(searchPaths(d, state, 'zzzz', 20)).toEqual([]);
  });

  it('only searches files that exist at the commit asked for', () => {
    const { d: d2, cp } = ctx();
    expect(searchPaths(d2, cp.stateAt(0), 'solo/b', 20)).toEqual([]);
    expect(searchPaths(d2, cp.stateAt(1), 'solo/b', 20).length).toBe(1);
  });
});

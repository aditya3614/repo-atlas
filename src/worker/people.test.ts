import { describe, it, expect } from 'vitest';
import { ChunkSplitter, LineParser } from './parse';
import { ModelBuilder, type Dataset } from './model';
import { FileIndex } from './fileIndex';
import { authorCommits, commitFiles, profileOf, searchPeople } from './people';

function build(text: string): Dataset {
  const b = new ModelBuilder();
  const s = new ChunkSplitter(new LineParser(b));
  s.push(text);
  s.end();
  return b.finish();
}

function commit(day: number, who: [string, string], rows: string[], hour = 12): string {
  const d = String(day).padStart(2, '0');
  const h = String(hour).padStart(2, '0');
  return `@@@\nh${day}${hour}${who[0]}\n${who[0]}\n${who[1]}\n2023-01-${d}T${h}:00:00Z\nwork on ${day}\n\n${rows.join('\n')}\n`;
}

const ADA: [string, string] = ['Ada Lovelace', 'ada@x.c'];
const GRACE: [string, string] = ['Grace Hopper', 'grace@x.c'];
const BOT: [string, string] = ['dependabot[bot]', 'support@dependabot.com'];

/*
 * Every commit is at midday UTC, so "the same day" and "the next day" hold in
 * any timezone the tests run in. Ada commits on days 1, 2 (twice, so it is her busiest day) and 5; Grace
 * works on 3, 4 and 7, and renames a file Ada wrote; a bot bumps a dependency.
 */
const HISTORY =
  commit(1, ADA, ['100\t0\tsolo/a.ts', '100\t0\tshared/x.ts']) +
  commit(2, ADA, ['100\t0\tsolo/b.ts'], 12) +
  commit(2, ADA, ['5\t1\tsolo/b.ts'], 13) +
  commit(3, GRACE, ['100\t0\tshared/y.ts']) +
  commit(4, GRACE, ['0\t0\tsolo/{a.ts => c.ts}', '50\t20\tshared/x.ts']) +
  commit(5, ADA, ['10\t5\tsolo/c.ts']) +
  commit(6, BOT, ['1\t1\tpackage.json']) +
  commit(7, GRACE, ['400\t400\tshared/y.ts']);

function ctx() {
  const d = build(HISTORY);
  return { d, index: new FileIndex(d) };
}
const idOf = (d: Dataset, name: string) => d.authors.names.indexOf(name);

describe('finding a person', () => {
  it('matches a first name, a surname, or part of an email', () => {
    const { d } = ctx();
    expect(searchPeople(d, 'ada', 5)[0]!.name).toBe('Ada Lovelace');
    expect(searchPeople(d, 'hopper', 5)[0]!.name).toBe('Grace Hopper');
    expect(searchPeople(d, 'grace@', 5)[0]!.name).toBe('Grace Hopper');
  });

  it('ranks a name that starts with the query above one that merely contains it', () => {
    const { d } = ctx();
    const hits = searchPeople(d, 'gra', 5);
    expect(hits.map((h) => h.name)).toEqual(['Grace Hopper']);
  });

  it('flags bots but still finds them', () => {
    const { d } = ctx();
    const hit = searchPeople(d, 'dependabot', 5)[0]!;
    expect(hit.bot).toBe(true);
    expect(hit.commits).toBe(1);
  });

  it('returns nothing for an empty or unknown query', () => {
    const { d } = ctx();
    expect(searchPeople(d, '', 5)).toEqual([]);
    expect(searchPeople(d, 'zzzz', 5)).toEqual([]);
  });
});

describe("reading one person's whole history", () => {
  it('counts commits, lines and share of the repository', () => {
    const { d, index } = ctx();
    const p = profileOf(d, index, idOf(d, 'Ada Lovelace'), 25);
    expect(p.commits).toBe(4);
    expect(p.commitShare).toBeCloseTo(4 / 8);
    expect(p.adds).toBe(100 + 100 + 100 + 5 + 10);
    expect(p.dels).toBe(1 + 5);
    expect(p.rank).toBe(1);
    expect(p.people).toBe(3);
  });

  it('finds the first and last commit', () => {
    const { d, index } = ctx();
    const p = profileOf(d, index, idOf(d, 'Ada Lovelace'), 25);
    expect(p.first.commit).toBe(0);
    expect(p.last.commit).toBe(5);
    expect(p.last.time).toBeGreaterThan(p.first.time);
  });

  it('finds the busiest day and the longest streak', () => {
    const { d, index } = ctx();
    const p = profileOf(d, index, idOf(d, 'Ada Lovelace'), 25);
    expect(p.busiest.commits).toBe(2);
    expect(p.activeDays).toBe(3);
    // Days 1 and 2 are consecutive; day 5 is not.
    expect(p.longestStreak).toBe(2);
  });

  it('lists the files touched, and which of them she wrote most of', () => {
    const { d, index } = ctx();
    const p = profileOf(d, index, idOf(d, 'Ada Lovelace'), 25);
    // solo/a.ts became solo/c.ts: one file, however often it was renamed.
    expect(p.filesTouched).toBe(3);
    expect(p.fileIds.length).toBe(3);
    expect(p.owns).toBeGreaterThanOrEqual(2);
    expect(p.topFolders[0]!.path).toBe('solo');
  });

  it('gives a bot a profile like anyone else', () => {
    const { d, index } = ctx();
    const p = profileOf(d, index, idOf(d, 'dependabot[bot]'), 25);
    expect(p.bot).toBe(true);
    expect(p.commits).toBe(1);
    expect(p.longestStreak).toBe(1);
  });

  it('splits activity over the repository’s whole life', () => {
    const { d, index } = ctx();
    const p = profileOf(d, index, idOf(d, 'Ada Lovelace'), 25);
    expect([...p.activity].reduce((a, b) => a + b, 0)).toBe(p.commits);
    expect([...p.weekdays].reduce((a, b) => a + b, 0)).toBe(p.commits);
  });
});

describe('their commits, and the files each one changed', () => {
  it('pages through commits newest first', () => {
    const { d } = ctx();
    const ada = idOf(d, 'Ada Lovelace');
    const first = authorCommits(d, ada, d.commitCount, 3);
    expect(first.commits.map((c) => c.commit)).toEqual([5, 2, 1]);
    expect(first.more).toBe(true);

    const rest = authorCommits(d, ada, 1, 3);
    expect(rest.commits.map((c) => c.commit)).toEqual([0]);
    expect(rest.more).toBe(false);
  });

  it('reports the size of each commit', () => {
    const { d } = ctx();
    const c = authorCommits(d, idOf(d, 'Ada Lovelace'), d.commitCount, 10).commits.at(-1)!;
    expect(c.files).toBe(2);
    expect(c.adds).toBe(200);
  });

  it('shows a file under the name it had when the commit was made', () => {
    const { d } = ctx();
    // Commit 4 renamed solo/a.ts to solo/c.ts; commit 0 still knew it as a.ts.
    expect(commitFiles(d, 0, 10).files.map((f) => f.path)).toContain('solo/a.ts');
    expect(commitFiles(d, 4, 10).files.map((f) => f.path)).toContain('solo/c.ts');
  });

  it('lists the biggest changes first and reports the true total', () => {
    const { d } = ctx();
    const r = commitFiles(d, 4, 1);
    expect(r.total).toBe(2);
    expect(r.files).toHaveLength(1);
  });
});

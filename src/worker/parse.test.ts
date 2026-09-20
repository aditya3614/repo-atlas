import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ChunkSplitter, LineParser, ParseError, type Change, type CommitHead } from './parse';
import { ModelBuilder } from './model';

const FIXTURE = readFileSync(new URL('./__fixtures__/git-fixture.txt', import.meta.url), 'utf8');

function collect(text: string, chunkSize = Infinity) {
  const commits: CommitHead[] = [];
  const changes: Change[] = [];
  const parser = new LineParser({
    commit: (c) => commits.push(c),
    change: (c) => changes.push(c),
  });
  const splitter = new ChunkSplitter(parser);
  if (chunkSize === Infinity) splitter.push(text);
  else for (let i = 0; i < text.length; i += chunkSize) splitter.push(text.slice(i, i + chunkSize));
  splitter.end();
  return { commits, changes };
}

describe('LineParser on real git output', () => {
  it('reads every commit in the fixture', () => {
    const { commits } = collect(FIXTURE);
    expect(commits.length).toBe(12);
    expect(commits[0]!.subject).toBe('initial: add engine');
    expect(commits[0]!.email).toBe('Ada@Example.com');
  });

  it('keeps a subject containing pipes and quotes intact', () => {
    const { commits } = collect(FIXTURE);
    expect(commits[1]!.subject).toBe(`empty commit | with a pipe and 'quotes' and a "dquote"`);
  });

  it('accepts a commit with no changes at all', () => {
    const { commits, changes } = collect(FIXTURE);
    // The empty commit is second; its hash must not appear on any change.
    expect(commits.length).toBe(12);
    expect(changes.every((c) => c.path !== '')).toBe(true);
  });

  it('reads a binary change as "-" on both counts', () => {
    const { changes } = collect(FIXTURE);
    const png = changes.find((c) => c.path === 'logo.png')!;
    expect(png.binary).toBe(true);
    expect(png.adds).toBe(0);
  });

  it('reconstructs renames from the fixture', () => {
    const { changes } = collect(FIXTURE);
    const paths = changes.map((c) => `${c.from ?? ''}>${c.path}`);
    expect(paths).toContain('src/core/engine.js>src/core/runner.js');
    expect(paths).toContain('src/core/runner.js>lib/kernel/runner.js');
    expect(paths).toContain('pkg/thing.txt>pkg/sub/thing.txt');
    expect(paths).toContain('pkg/sub/thing.txt>pkg/thing.txt');
    expect(paths).toContain('sub/naïve file.txt>naïve file.txt');
  });

  it('produces identical results whatever the chunk boundaries are', () => {
    const whole = collect(FIXTURE);
    for (const size of [1, 2, 3, 7, 64, 997]) {
      const split = collect(FIXTURE, size);
      expect(split.commits, `chunk size ${size}`).toEqual(whole.commits);
      expect(split.changes, `chunk size ${size}`).toEqual(whole.changes);
    }
  });

  it('handles CRLF line endings and a BOM', () => {
    const crlf = '﻿' + FIXTURE.replace(/\n/g, '\r\n');
    const { commits } = collect(crlf);
    expect(commits.length).toBe(12);
    expect(commits[0]!.hash).toBe(collect(FIXTURE).commits[0]!.hash);
  });
});

describe('LineParser errors', () => {
  const head = '@@@\nabc\nAda\na@b.c\n2020-01-01T00:00:00Z\nsubject\n\n';

  it('points at the line that is not a separator', () => {
    let err: ParseError | undefined;
    try {
      collect('\n\ncommit 9f2c\n');
    } catch (e) {
      err = e as ParseError;
    }
    expect(err?.line).toBe(3);
    expect(err?.offending).toBe('commit 9f2c');
  });

  it('points at a malformed change line', () => {
    let err: ParseError | undefined;
    try {
      collect(head + '2 0 src/a.js\n');
    } catch (e) {
      err = e as ParseError;
    }
    expect(err?.line).toBe(8);
    expect(err?.offending).toBe('2 0 src/a.js');
    expect(err?.hint).toMatch(/numstat/);
  });

  it('rejects counts that are not numbers', () => {
    let err: ParseError | undefined;
    try {
      collect(head + 'two\t0\tsrc/a.js\n');
    } catch (e) {
      err = e as ParseError;
    }
    expect(err?.line).toBe(8);
  });

  it('rejects a file that ends mid-commit', () => {
    expect(() => collect('@@@\nabc\nAda\n')).toThrow(ParseError);
  });

  it('accepts a file whose last line has no trailing newline', () => {
    const { changes } = collect(head + '2\t0\tsrc/a.js');
    expect(changes.length).toBe(1);
  });
});

describe('ModelBuilder', () => {
  function build(text: string) {
    const b = new ModelBuilder();
    const splitter = new ChunkSplitter(new LineParser(b));
    splitter.push(text);
    splitter.end();
    return b.finish();
  }

  it('keeps one file identity across a chain of renames', () => {
    const d = build(FIXTURE);
    // engine.js -> runner.js -> lib/kernel/runner.js is one file, not three.
    const runnerIds = new Set<number>();
    for (let i = 0; i < d.fileIds.length; i++) {
      const p = d.paths[d.changePath[i]!]!;
      if (p.endsWith('runner.js') || p.endsWith('engine.js')) runnerIds.add(d.fileIds[i]!);
    }
    expect(runnerIds.size).toBe(1);
  });

  it('folds authors by lower-cased email and picks the common spelling', () => {
    const d = build(FIXTURE);
    expect(d.authors.emails).toContain('ada@example.com');
    expect(d.authors.names[d.authors.emails.indexOf('ada@example.com')]).toBe('Ada Lovelace');
    expect(d.authors.emails.length).toBe(2);
  });

  it('never lets the time axis go backwards after a rebase', () => {
    const d = build(FIXTURE);
    for (let i = 1; i < d.time.length; i++) expect(d.time[i]!).toBeGreaterThanOrEqual(d.time[i - 1]!);
    // The raw date is kept as git recorded it, including the older one.
    expect(Math.min(...d.rawTime)).toBeLessThan(d.time[0]!);
  });

  it('flags bot accounts', () => {
    const d = build(
      '@@@\nh\ndependabot[bot]\nsupport@dependabot.com\n2020-01-01T00:00:00Z\nbump\n\n1\t1\tpackage.json\n',
    );
    expect(d.authors.bot[0]).toBe(1);
  });
});

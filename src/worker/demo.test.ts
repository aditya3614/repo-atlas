import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ChunkSplitter, LineParser } from './parse';
import { ModelBuilder } from './model';
import { Checkpoints } from './state';

/**
 * The bundled demo is a real history, so its numbers can be checked against
 * git by hand. These were verified against the axios clone on 21 Sep 2026:
 *
 *   git log --no-merges --oneline | wc -l                        -> 1987
 *   git log --no-merges --format=%ae | tr A-Z a-z | sort -u | wc -> 676
 *   git log --no-merges --format='%an <%ae>' | grep -ci bot…     -> 214
 *   git ls-files | wc -l                                         -> 473
 */
const GIT = { commits: 1987, authors: 676, botCommits: 214, filesAtHead: 473 };

describe('the bundled demo history', () => {
  const text = readFileSync('public/demo/axios-history.txt', 'utf8');
  const b = new ModelBuilder();
  const s = new ChunkSplitter(new LineParser(b));
  s.push(text);
  s.end();
  const d = b.finish();
  const cp = new Checkpoints(d);

  it('reads the same number of commits as git', () => {
    expect(d.commitCount).toBe(GIT.commits);
  });

  it('folds to the same number of author identities as git', () => {
    expect(d.authors.names.length).toBe(GIT.authors);
  });

  it('attributes the same number of commits to bots as git', () => {
    let bots = 0;
    for (let i = 0; i < d.authors.bot.length; i++) {
      if (d.authors.bot[i] === 1) bots += d.authors.commits[i]!;
    }
    expect(bots).toBe(GIT.botCommits);
  });

  it('has every file git has at HEAD, and a handful it no longer does', () => {
    const st = cp.stateAt(d.commitCount - 1);
    let alive = 0;
    for (let f = 0; f < d.fileCount; f++) if (st.alive[f] === 1) alive++;

    // Checked against `git ls-files`: all 473 real files are present, plus 7
    // that numstat cannot see removed — one deleted binary (binary rows carry
    // no line counts) and six files whose deletion exists only inside a merge
    // commit, which --no-merges leaves out. The overshoot is ~1.5%.
    expect(alive).toBeGreaterThanOrEqual(GIT.filesAtHead);
    expect(alive).toBeLessThan(GIT.filesAtHead * 1.05);
  });

  it('keeps the timeline inside the dates git reports', () => {
    expect(new Date(d.time[0]!).getUTCFullYear()).toBe(2014);
    expect(new Date(d.time[d.commitCount - 1]!).getUTCFullYear()).toBe(2026);
  });
});

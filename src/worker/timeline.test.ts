import { describe, it, expect } from 'vitest';
import { ChunkSplitter, LineParser } from './parse';
import { ModelBuilder, type Dataset } from './model';
import { buildTimeline, commitAt, SERIES } from './timeline';
import { buildCoChange } from './cochange';

function build(text: string): Dataset {
  const b = new ModelBuilder();
  const s = new ChunkSplitter(new LineParser(b));
  s.push(text);
  s.end();
  return b.finish();
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** n commits an hour apart, then one after a long silence. */
function history(opts: { n: number; gapAfter?: number; gapDays?: number; author?: (k: number) => [string, string] }) {
  let t = Date.UTC(2021, 0, 4, 9);
  let out = '';
  for (let k = 0; k < opts.n; k++) {
    if (opts.gapAfter !== undefined && k === opts.gapAfter) t += (opts.gapDays ?? 120) * DAY;
    else if (k > 0) t += HOUR;
    const [name, email] = opts.author ? opts.author(k) : ['Ada', 'ada@x.c'];
    out += `@@@\nh${k}\n${name}\n${email}\n${new Date(t).toISOString()}\nc${k}\n\n1\t0\tsrc/f${k % 7}.ts\n`;
  }
  return out;
}

describe('playback timeline', () => {
  it('maps a position back to the commit it belongs to', () => {
    const t = buildTimeline(build(history({ n: 40 })), false);
    expect(commitAt(t.cumReal, 0)).toBe(0);
    expect(commitAt(t.cumReal, t.cumReal[10]!)).toBe(10);
    expect(commitAt(t.cumReal, t.cumReal[10]! + HOUR / 2)).toBe(10);
    expect(commitAt(t.cumReal, t.totalReal)).toBe(40 - 1);
  });

  it('compresses a long silence but keeps real time available', () => {
    const d = build(history({ n: 40, gapAfter: 20, gapDays: 120 }));
    const t = buildTimeline(d, false);

    expect(t.quietGaps).toBe(1);
    // Real time is dominated by the 120-day hole; skipped time is not.
    expect(t.totalReal).toBeGreaterThan(100 * DAY);
    expect(t.totalSkip).toBeLessThan(10 * DAY);
    // Both timelines still cover every commit, in order.
    for (let k = 1; k < d.commitCount; k++) {
      expect(t.cumSkip[k]!).toBeGreaterThanOrEqual(t.cumSkip[k - 1]!);
      expect(t.cumReal[k]!).toBeGreaterThanOrEqual(t.cumReal[k - 1]!);
    }
  });

  it('bins commits into weeks and keeps every one of them', () => {
    const d = build(history({ n: 500 }));
    const t = buildTimeline(d, false);
    let total = 0;
    for (let i = 0; i < t.series.length; i++) total += t.series[i]!;
    expect(total).toBe(d.commitCount);
    expect(t.weeks).toBeGreaterThan(1);
    expect(t.peakWeek).toBeGreaterThan(0);
  });

  it('keeps the top authors in their own series and pools the rest', () => {
    // Ten authors, so two must fall into "everyone else".
    const d = build(
      history({ n: 300, author: (k) => [`Dev${k % 10}`, `dev${k % 10}@x.c`] }),
    );
    const t = buildTimeline(d, false);
    expect(t.seriesAuthors.length).toBe(SERIES);
    expect(t.seriesAuthors[SERIES - 1]).toBe(-1);
    const named = Array.from(t.seriesAuthors).filter((a) => a >= 0);
    expect(named.length).toBe(SERIES - 1);
    // Everyone else is not empty, since ten authors do not fit seven slots.
    let others = 0;
    for (let w = 0; w < t.weeks; w++) others += t.series[(SERIES - 1) * t.weeks + w]!;
    expect(others).toBeGreaterThan(0);
  });

  it('leaves bots out unless they are asked for', () => {
    const text =
      history({ n: 20 }) +
      '@@@\nb1\ndependabot[bot]\nsupport@dependabot.com\n2021-02-01T00:00:00Z\nbump\n\n1\t1\tpackage.json\n';
    const d = build(text);
    const without = buildTimeline(d, false);
    const with_ = buildTimeline(d, true);
    const sum = (t: typeof without) => {
      let n = 0;
      for (let i = 0; i < t.series.length; i++) n += t.series[i]!;
      return n;
    };
    expect(sum(without)).toBe(20);
    expect(sum(with_)).toBe(21);
  });

  it('survives a history of a single commit', () => {
    const t = buildTimeline(build(history({ n: 1 })), false);
    expect(t.weeks).toBeGreaterThanOrEqual(1);
    expect(t.totalSkip).toBeGreaterThan(0);
    expect(commitAt(t.cumSkip, t.totalSkip)).toBe(0);
  });
});

describe('co-change', () => {
  const pairText =
    // a.ts and b.ts always move together; c.ts moves alone.
    Array.from({ length: 12 }, (_, k) =>
      `@@@\nh${k}\nAda\nada@x.c\n2021-01-${String(k + 1).padStart(2, '0')}T00:00:00Z\nc\n\n` +
      `1\t0\tsrc/a.ts\n1\t0\tsrc/b.ts\n`,
    ).join('') +
    Array.from({ length: 5 }, (_, k) =>
      `@@@\nz${k}\nAda\nada@x.c\n2021-02-${String(k + 1).padStart(2, '0')}T00:00:00Z\nc\n\n1\t0\tsrc/c.ts\n`,
    ).join('');

  it('finds the pair that always changes together', () => {
    const d = build(pairText);
    const co = buildCoChange(d, 20);
    expect(co.counts.length).toBeGreaterThan(0);
    expect(co.maxCount).toBe(12);
    const top = [co.pairs[0]!, co.pairs[1]!].map((f) => d.paths[d.files.firstPath[f]!]!).sort();
    expect(top).toEqual(['src/a.ts', 'src/b.ts']);
    expect(co.commitsConsidered).toBe(12);
  });

  it('ignores sweeping commits, which relate everything to everything', () => {
    let wide = '@@@\nw\nAda\nada@x.c\n2021-03-01T00:00:00Z\nrefactor everything\n\n';
    for (let i = 0; i < 40; i++) wide += `1\t1\tsrc/w${i}.ts\n`;
    const co = buildCoChange(build(pairText + wide), 50);
    // The 40-file commit is over the fan-out limit, so it contributes nothing.
    expect(co.commitsConsidered).toBe(12);
  });

  it('returns nothing for a history where files never share a commit', () => {
    const co = buildCoChange(
      build(
        Array.from({ length: 6 }, (_, k) =>
          `@@@\nh${k}\nAda\nada@x.c\n2021-01-0${k + 1}T00:00:00Z\nc\n\n1\t0\tsrc/${k}.ts\n`,
        ).join(''),
      ),
      10,
    );
    expect(co.counts.length).toBe(0);
    expect(co.maxCount).toBe(0);
  });
});

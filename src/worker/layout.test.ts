import { describe, it, expect } from 'vitest';
import { ChunkSplitter, LineParser } from './parse';
import { ModelBuilder, type Dataset } from './model';
import { Checkpoints } from './state';
import { FileIndex, classify, TYPE } from './fileIndex';
import { computeLayout } from './layout';

function build(text: string): Dataset {
  const b = new ModelBuilder();
  const s = new ChunkSplitter(new LineParser(b));
  s.push(text);
  s.end();
  return b.finish();
}

function commit(n: number, rows: string[]): string {
  const day = String(n).padStart(2, '0');
  return `@@@\nh${n}\nAda\na@b.c\n2021-01-${day}T00:00:00Z\nc${n}\n\n${rows.join('\n')}\n`;
}

const HISTORY =
  commit(1, ['10\t0\tsrc/a.ts', '10\t0\tsrc/b.ts', '10\t0\tsrc/deep/c.ts', '10\t0\tdocs/readme.md']) +
  commit(2, ['400\t0\tsrc/b.ts']);

function layoutAt(d: Dataset, k: number, root = '', weighting: 'balanced' | 'linear' = 'balanced') {
  const cp = new Checkpoints(d);
  const index = new FileIndex(d);
  return computeLayout(d, index, cp.stateAt(k), {
    commit: k,
    width: 600,
    height: 400,
    root,
    weighting,
  });
}

describe('treemap layout', () => {
  const d = build(HISTORY);

  it('keeps sibling order by name, so a file growing does not move cells', () => {
    const before = layoutAt(d, 0);
    const after = layoutAt(d, 1);
    const names = (l: ReturnType<typeof layoutAt>) =>
      Array.from(l.pathIds).map((p) => d.paths[p]!);
    // src/b.ts grows 40x between the two commits; the order must not change.
    expect(names(after)).toEqual(names(before));
    expect(after.size[names(after).indexOf('src/b.ts')]).toBe(410);
  });

  it('gives every cell a rectangle inside the canvas', () => {
    const l = layoutAt(d, 1);
    for (let i = 0; i < l.fileIds.length; i++) {
      expect(l.rects[i * 4]!).toBeGreaterThanOrEqual(0);
      expect(l.rects[i * 4 + 1]!).toBeGreaterThanOrEqual(0);
      expect(l.rects[i * 4 + 2]!).toBeLessThanOrEqual(600);
      expect(l.rects[i * 4 + 3]!).toBeLessThanOrEqual(400);
      expect(l.rects[i * 4 + 2]!).toBeGreaterThan(l.rects[i * 4]!);
    }
  });

  it('never overlaps two cells', () => {
    const l = layoutAt(d, 1);
    const r = l.rects;
    for (let i = 0; i < l.fileIds.length; i++) {
      for (let j = i + 1; j < l.fileIds.length; j++) {
        const apart =
          r[i * 4 + 2]! <= r[j * 4]! ||
          r[j * 4 + 2]! <= r[i * 4]! ||
          r[i * 4 + 3]! <= r[j * 4 + 1]! ||
          r[j * 4 + 3]! <= r[i * 4 + 1]!;
        expect(apart, `cells ${i} and ${j} overlap`).toBe(true);
      }
    }
  });

  it('drills into a folder and drops everything outside it', () => {
    const l = layoutAt(d, 1, 'src');
    const paths = Array.from(l.pathIds).map((p) => d.paths[p]!);
    expect(paths).toContain('src/a.ts');
    expect(paths).not.toContain('docs/readme.md');
    // The whole canvas now belongs to src, and aliveCount still counts the repo.
    expect(l.aliveCount).toBe(4);
    expect(l.fileIds.length).toBe(3);
  });

  it('balanced weighting compresses the gap that linear exaggerates', () => {
    const area = (l: ReturnType<typeof layoutAt>, path: string) => {
      const i = Array.from(l.pathIds).findIndex((p) => d.paths[p] === path);
      return (l.rects[i * 4 + 2]! - l.rects[i * 4]!) * (l.rects[i * 4 + 3]! - l.rects[i * 4 + 1]!);
    };
    const linear = layoutAt(d, 1, '', 'linear');
    const balanced = layoutAt(d, 1, '', 'balanced');
    const ratio = (l: ReturnType<typeof layoutAt>) => area(l, 'src/b.ts') / area(l, 'src/a.ts');
    expect(ratio(linear)).toBeGreaterThan(ratio(balanced));
    // Size order still holds: the big file is still the big cell.
    expect(ratio(balanced)).toBeGreaterThan(1);
  });

  it('reports folder regions with full paths', () => {
    const l = layoutAt(d, 1);
    expect(l.folderPaths).toContain('src');
    expect(l.folderPaths).toContain('src/deep');
    expect(l.folderNames[l.folderPaths.indexOf('src/deep')]).toBe('deep');
  });

  it('leaves deleted files off the map', () => {
    const d2 = build(HISTORY + commit(3, ['0\t10\tsrc/a.ts']));
    const l = layoutAt(d2, 2);
    expect(Array.from(l.pathIds).map((p) => d2.paths[p]!)).not.toContain('src/a.ts');
  });
});

describe('file type classification', () => {
  it('sorts paths into the five kinds', () => {
    expect(classify('src/core/router.ts')).toBe(TYPE.code);
    expect(classify('test/unit/router.spec.ts')).toBe(TYPE.tests);
    expect(classify('src/router.test.ts')).toBe(TYPE.tests);
    expect(classify('docs/guide.md')).toBe(TYPE.docs);
    expect(classify('README.md')).toBe(TYPE.docs);
    expect(classify('package.json')).toBe(TYPE.config);
    expect(classify('.eslintrc')).toBe(TYPE.config);
    expect(classify('assets/logo.png')).toBe(TYPE.assets);
    expect(classify('fonts/Inter.woff2')).toBe(TYPE.assets);
  });

  it('prefers tests over the extension it happens to use', () => {
    expect(classify('tests/fixtures/data.json')).toBe(TYPE.tests);
  });
});

describe('dominant author and history', () => {
  it('credits the author who added the most lines', () => {
    const text =
      '@@@\nh1\nAda\nada@x.c\n2021-01-01T00:00:00Z\nc\n\n100\t0\tsrc/a.ts\n' +
      '@@@\nh2\nGrace\ngrace@x.c\n2021-01-02T00:00:00Z\nc\n\n5\t0\tsrc/a.ts\n';
    const d2 = build(text);
    const index = new FileIndex(d2);
    expect(d2.authors.names[index.dominantAuthor[0]!]).toBe('Ada');
  });

  it('returns a size history that ends at the current size', () => {
    const d2 = build(HISTORY);
    const index = new FileIndex(d2);
    const f = Array.from(d2.files.firstPath).findIndex((p) => d2.paths[p] === 'src/b.ts');
    const hist = index.sizeHistory(f, 30, 40);
    expect(hist[hist.length - 1]).toBe(410);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Section 11 asks for the author palette to be checked against colourblind
 * simulations. Ten categorical colours are only useful if they stay apart for
 * the people who cannot separate red from green.
 *
 * Simulation follows Viénot, Brettel and Mollon (1999): convert to linear RGB,
 * project onto the plane the missing cone leaves behind, convert back. Distance
 * is CIE76 in Lab, which is close enough for "are these two swatches telling
 * different stories".
 */

const css = readFileSync('src/styles/tokens.css', 'utf8');

function token(name: string): string {
  const m = css.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-f]{6})`, 'i'));
  if (!m) throw new Error(`missing ${name}`);
  return m[1]!;
}

type RGB = [number, number, number];

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const toSrgb = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055;

function parse(hex: string): RGB {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
}

function mul(m: number[][], v: RGB): RGB {
  return [
    m[0]![0]! * v[0] + m[0]![1]! * v[1] + m[0]![2]! * v[2],
    m[1]![0]! * v[0] + m[1]![1]! * v[1] + m[1]![2]! * v[2],
    m[2]![0]! * v[0] + m[2]![1]! * v[1] + m[2]![2]! * v[2],
  ];
}

/** Linear-RGB simulation matrices for the three dichromacies. */
const SIMS: Record<string, number[][]> = {
  protanopia: [
    [0.1121, 0.8853, -0.0005],
    [0.1127, 0.8897, -0.0001],
    [0.0045, 0.0, 1.0019],
  ],
  deuteranopia: [
    [0.292, 0.7054, -0.0003],
    [0.2934, 0.7089, 0.0001],
    [-0.0209, 0.0272, 0.9922],
  ],
  tritanopia: [
    [1.0166, 0.0859, -0.1003],
    [0.0077, 0.9583, 0.0342],
    [-0.0117, 0.0405, 0.9707],
  ],
};

function simulate(hex: string, kind: keyof typeof SIMS | 'normal'): RGB {
  const lin = parse(hex).map(toLinear) as RGB;
  const out = kind === 'normal' ? lin : mul(SIMS[kind]!, lin);
  return out.map(toSrgb) as RGB;
}

function lab([r, g, b]: RGB): RGB {
  const [lr, lg, lb] = [r, g, b].map(toLinear) as RGB;
  // sRGB to XYZ (D65), then XYZ to Lab.
  const x = (0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.9505;
  const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  const z = (0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.089;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE(a: RGB, b: RGB): number {
  const la = lab(a);
  const lb2 = lab(b);
  return Math.hypot(la[0] - lb2[0], la[1] - lb2[1], la[2] - lb2[2]);
}

const AUTHOR = [
  '--cat-1', '--cat-2', '--cat-3', '--cat-4', '--cat-5',
  '--cat-6', '--cat-7', '--cat-8', '--cat-9', '--cat-10', '--cat-rest',
].map(token);

const TYPES_NIGHT = ['--type-code', '--type-tests', '--type-docs', '--type-config', '--type-assets']
  .map(token);

/** Below this two swatches start reading as "the same colour, roughly". */
const MIN_DELTA = 11;

describe('the author palette under colourblind simulation', () => {
  for (const kind of ['normal', 'protanopia', 'deuteranopia', 'tritanopia'] as const) {
    it(`keeps its colours apart for ${kind}`, () => {
      const sims = AUTHOR.map((c) => simulate(c, kind));
      let worst = Infinity;
      let pair = '';
      for (let i = 0; i < sims.length; i++) {
        for (let j = i + 1; j < sims.length; j++) {
          const d = deltaE(sims[i]!, sims[j]!);
          if (d < worst) {
            worst = d;
            pair = `${AUTHOR[i]} vs ${AUTHOR[j]}`;
          }
        }
      }
      expect(Number(worst.toFixed(1)), `closest pair under ${kind}: ${pair}`).toBeGreaterThan(
        MIN_DELTA,
      );
    });
  }
});

describe('the file-type palette under colourblind simulation', () => {
  for (const kind of ['protanopia', 'deuteranopia', 'tritanopia'] as const) {
    it(`keeps its five kinds apart for ${kind}`, () => {
      const sims = TYPES_NIGHT.map((c) => simulate(c, kind));
      for (let i = 0; i < sims.length; i++) {
        for (let j = i + 1; j < sims.length; j++) {
          expect(
            Number(deltaE(sims[i]!, sims[j]!).toFixed(1)),
            `${TYPES_NIGHT[i]} vs ${TYPES_NIGHT[j]} under ${kind}`,
          ).toBeGreaterThan(MIN_DELTA);
        }
      }
    });
  }
});

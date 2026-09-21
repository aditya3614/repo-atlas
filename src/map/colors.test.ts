import { describe, it, expect } from 'vitest';
import { tokensFor, type ThemeName } from '../test/tokens';
import {
  MIN_CONTRAST,
  buildPalette,
  contrastRatio,
  luminance,
  parseColour,
  type Palette,
} from './colors';

describe('reading colours', () => {
  it('understands hex, short hex and the rgb() form d3 produces', () => {
    expect(parseColour('#9fe870')).toEqual([159, 232, 112]);
    expect(parseColour('#fff')).toEqual([255, 255, 255]);
    expect(parseColour('rgb(95, 138, 66)')).toEqual([95, 138, 66]);
    expect(parseColour('rgba(10, 20, 30, 0.5)')).toEqual([10, 20, 30]);
    expect(parseColour('rgb(10 20 30)')).toEqual([10, 20, 30]);
  });

  it('refuses a colour it cannot read instead of guessing', () => {
    // The bug this guards against: an unreadable colour used to become mid-grey,
    // which quietly gave every interpolated shade the wrong label colour.
    for (const bad of ['', 'banana', '#12', 'var(--x)', 'rgb(a, b, c)']) {
      expect(() => parseColour(bad), bad).toThrow(/Cannot read/);
    }
  });

  it('agrees with the WCAG extremes', () => {
    expect(luminance('#000000')).toBeCloseTo(0, 5);
    expect(luminance('rgb(255, 255, 255)')).toBeCloseTo(1, 5);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });
});

/** Every shade of every palette, with the group it belongs to. */
function shades(pal: Palette): [string, string, number][] {
  const out: [string, string, number][] = [];
  for (const group of ['activity', 'age', 'churn', 'author', 'type'] as const) {
    pal[group].forEach((colour, i) => out.push([group, colour, i]));
  }
  return out;
}

describe.each(['night', 'paper'] as ThemeName[])('the %s palette as the renderer builds it', (theme) => {
  const pal = buildPalette(tokensFor(theme), theme);

  it('gives every shade a label ink that reaches the minimum contrast', () => {
    const failures: string[] = [];
    for (const group of ['activity', 'age', 'churn', 'author', 'type'] as const) {
      pal[group].forEach((colour, i) => {
        const ink = pal.needsDarkInk[group][i] === 1 ? pal.inkDark : pal.inkLight;
        const ratio = contrastRatio(colour, ink);
        if (ratio < MIN_CONTRAST) failures.push(`${group}[${i}] ${colour}: ${ratio.toFixed(2)}:1`);
      });
    }
    expect(failures, failures.slice(0, 5).join('\n')).toEqual([]);
  });

  it('picks the better ink for every shade, whatever the ramp looks like', () => {
    // The regression: with every interpolated shade misread as mid-grey, the
    // hottest, brightest cell on the map was handed white text. Whatever a
    // theme's ramps look like, the ink chosen must be the one that reads better.
    const wrong: string[] = [];
    for (const group of ['activity', 'age', 'churn', 'author', 'type'] as const) {
      pal[group].forEach((colour, i) => {
        const chosen = pal.needsDarkInk[group][i] === 1 ? pal.inkDark : pal.inkLight;
        const other = pal.needsDarkInk[group][i] === 1 ? pal.inkLight : pal.inkDark;
        if (contrastRatio(colour, chosen) < contrastRatio(colour, other)) {
          wrong.push(`${group}[${i}] ${colour}`);
        }
      });
    }
    expect(wrong, wrong.slice(0, 5).join('\n')).toEqual([]);
  });

  it('never hands light ink to a bright shade or dark ink to a dark one', () => {
    for (const [group, colour, i] of shades(pal)) {
      const lum = luminance(colour);
      const dark = pal.needsDarkInk[group as 'activity'][i] === 1;
      if (lum > 0.5) expect(dark, `${group}[${i}] ${colour} is bright`).toBe(true);
      if (lum < 0.05) expect(dark, `${group}[${i}] ${colour} is dark`).toBe(false);
    }
  });

  // Night's ramps run from near-black to bright, so they must use both inks.
  // Paper's activity ramp is light throughout, where dark ink throughout is right.
  it.runIf(theme === 'night')('uses both inks across a ramp that spans dark to bright', () => {
    for (const group of ['activity', 'age', 'churn'] as const) {
      expect(new Set(pal.needsDarkInk[group]).size, `${group} uses both inks`).toBe(2);
    }
  });

  it('keeps every ramp continuous enough to read as a ramp', () => {
    // Borrowing a neighbour's colour must not turn a ramp into a few big blocks.
    for (const group of ['activity', 'age', 'churn'] as const) {
      const distinct = new Set(pal[group]).size;
      expect(distinct, `${group} distinct shades`).toBeGreaterThanOrEqual(48);
    }
  });

  it('has shades to test at all', () => {
    expect(shades(pal).length).toBeGreaterThan(200);
  });
});

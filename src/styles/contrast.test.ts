import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Section 11 asks for text contrast of at least 4.5:1. This reads the tokens
 * straight out of the stylesheet and checks every pairing the UI actually
 * uses, in both themes, so a colour tweak cannot quietly break legibility.
 */

const css = readFileSync('src/styles/tokens.css', 'utf8');

function block(selector: string): Record<string, string> {
  const i = css.indexOf(selector);
  if (i < 0) throw new Error(`no block for ${selector}`);
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  const out: Record<string, string> = {};
  for (const line of css.slice(open + 1, close).split('\n')) {
    const m = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i);
    if (m) out[m[1]!] = m[2]!.trim();
  }
  return out;
}

const shared = block(':root {');
const night = { ...shared, ...block(":root[data-theme='night']") };
const paper = { ...shared, ...block(":root[data-theme='paper']") };

function rgb(v: string): [number, number, number] {
  const hex = v.trim();
  if (!hex.startsWith('#')) throw new Error(`expected a hex colour, got ${hex}`);
  const n = hex.length === 4
    ? hex.slice(1).split('').map((c) => parseInt(c + c, 16))
    : [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return [n[0]!, n[1]!, n[2]!];
}

function luminance(v: string): number {
  const [r, g, b] = rgb(v).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const PAIRS: [string, string, string][] = [
  ['body text on the page', '--text', '--bg'],
  ['secondary text on the page', '--text-muted', '--bg'],
  ['faint text on the page', '--text-faint', '--bg'],
  ['body text on a surface', '--text', '--surface-2'],
  ['secondary text on a surface', '--text-muted', '--surface-2'],
  ['faint text on a surface', '--text-faint', '--surface-2'],
  ['button label on the accent', '--accent-ink', '--accent'],
  ['text on the map background', '--text-muted', '--map-void'],
];

describe.each([
  ['night', night],
  ['paper', paper],
])('%s theme', (name, vars) => {
  it.each(PAIRS)('%s reaches 4.5:1', (_label, fg, bg) => {
    const ratio = contrast(vars[fg]!, vars[bg]!);
    expect(
      Number(ratio.toFixed(2)),
      `${name}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('has a label colour that works on every cell colour', () => {
    // Map labels sit directly on a cell, so one fixed colour cannot work for
    // both ends of a ramp. Each cell picks ink or paper by its own luminance.
    const inks = [vars['--label-on-light']!, vars['--label-on-dark']!];
    const cellColours = [
      '--heat-0', '--heat-1', '--heat-2', '--heat-3', '--heat-4',
      '--age-new', '--age-mid', '--age-old',
      '--type-code', '--type-tests', '--type-docs', '--type-config', '--type-assets',
      '--cat-1', '--cat-2', '--cat-3', '--cat-4', '--cat-5',
      '--cat-6', '--cat-7', '--cat-8', '--cat-9', '--cat-10', '--cat-rest',
    ];
    for (const token of cellColours) {
      const cell = vars[token]!;
      const best = Math.max(contrast(inks[0]!, cell), contrast(inks[1]!, cell));
      expect(
        Number(best.toFixed(2)),
        `${name}: no label ink reaches 4.5:1 on ${token} (${cell})`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

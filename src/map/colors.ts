import { scaleLinear } from 'd3-scale';
import { interpolateRgb } from 'd3-interpolate';

/**
 * Colour for the map, as lookup tables.
 *
 * Every mode resolves to an index into a 64-entry table built once per theme,
 * so drawing a cell is an array read: no interpolation, no string building and
 * no allocation in the frame loop.
 */

export const MODES = ['activity', 'author', 'age', 'churn', 'type'] as const;
export type Mode = (typeof MODES)[number];

export const MODE_LABELS: Record<Mode, string> = {
  activity: 'Activity',
  author: 'Author',
  age: 'Age',
  churn: 'Churn',
  type: 'Type',
};

export const MODE_HINTS: Record<Mode, string> = {
  activity: 'Recently changed files stand out; the colour decays as they go quiet.',
  author: 'Who has added the most lines to each file.',
  age: 'When the file first appeared in the history.',
  churn: 'Lines added plus deleted over the file’s whole life.',
  type: 'Code, tests, docs, config or assets, from the file’s extension.',
};

const LUT_N = 64;

function ramp(stops: string[], domain?: number[]): string[] {
  const d = domain ?? stops.map((_, i) => i / (stops.length - 1));
  const scale = scaleLinear<string>().domain(d).range(stops).interpolate(interpolateRgb);
  const out: string[] = [];
  for (let i = 0; i < LUT_N; i++) out.push(scale(i / (LUT_N - 1)));
  return out;
}

export interface Palette {
  activity: string[];
  age: string[];
  churn: string[];
  /** Ten author colours plus one for everyone else. */
  author: string[];
  type: string[];
  /** Fill behind cells too small to draw individually. */
  dust: string;
  void: string;
  hairline: string;
  folderLine: string;
  label: string;
  labelStrong: string;
  selection: string;
  glow: string;
  /** Additive glow only works on a dark ground; Paper outlines instead. */
  dark: boolean;
  hot: string;
  /** Flash on a file's first appearance. */
  fresh: string;
  /** Outline a deleted file leaves behind. */
  ghost: string;
  arc: string;
}

export function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();

  return {
    // Warm colours are pushed to the top of the ramp: at the latest commit
    // most files have been touched at some point, and if "touched once" already
    // reads as hot then nothing stands out.
    activity: ramp(
      [v('--heat-0'), v('--heat-1'), v('--heat-2'), v('--heat-3'), v('--heat-4')],
      [0, 0.42, 0.68, 0.86, 1],
    ),
    age: ramp([v('--age-old'), v('--age-mid'), v('--age-new')]),
    churn: ramp([v('--churn-0'), v('--churn-1'), v('--churn-2')]),
    author: [
      v('--cat-1'), v('--cat-2'), v('--cat-3'), v('--cat-4'), v('--cat-5'),
      v('--cat-6'), v('--cat-7'), v('--cat-8'), v('--cat-9'), v('--cat-10'),
      v('--cat-rest'),
    ],
    type: [v('--type-code'), v('--type-tests'), v('--type-docs'), v('--type-config'), v('--type-assets')],
    dust: v('--map-dust'),
    void: v('--map-void'),
    hairline: v('--hairline'),
    folderLine: v('--map-folder-line'),
    label: v('--text-faint'),
    labelStrong: v('--text-muted'),
    selection: v('--info'),
    glow: v('--accent'),
    dark: (el.dataset.theme ?? 'night') !== 'paper',
    hot: v('--heat-4'),
    fresh: v('--accent'),
    ghost: v('--danger'),
    arc: v('--info'),
  };
}

/**
 * Heat saturates rather than being normalised against the current frame's
 * maximum: a cell must not change colour just because a hotter file appeared
 * somewhere else on the map.
 */
export function activityT(heat: number): number {
  return 1 - Math.exp(-heat / 4);
}

export function ageT(firstTime: number, from: number, to: number): number {
  if (to <= from) return 1;
  const t = (firstTime - from) / (to - from);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function churnT(churn: number, maxChurn: number): number {
  if (maxChurn <= 0) return 0;
  return Math.log1p(churn) / Math.log1p(maxChurn);
}

export function lutIndex(t: number): number {
  const i = (t * (LUT_N - 1)) | 0;
  return i < 0 ? 0 : i > LUT_N - 1 ? LUT_N - 1 : i;
}

/** Pre-rendered soft sprite: additive blending, never shadowBlur. */
export function makeGlowSprite(color: string, size = 128): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.4, `${color}66`);
  grad.addColorStop(1, 'transparent');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

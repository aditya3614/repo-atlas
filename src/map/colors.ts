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

/*
 * Labels say what the colour means, not what the measure is called. "Churn" and
 * "activity" are words this project's authors use; nobody arriving at the map
 * for the first time knows them.
 */
export const MODE_LABELS: Record<Mode, string> = {
  activity: 'Recently changed',
  author: 'Who wrote it',
  age: 'How old',
  churn: 'How often rewritten',
  type: 'Kind of file',
};

/** One sentence, in the legend, saying what you are looking at. */
export const MODE_HINTS: Record<Mode, string> = {
  activity:
    'How recently each file changed, as of the date on the playhead. Files touched just now are brightest and fade as they go quiet.',
  author: 'Whoever has added the most lines to each file over its whole life.',
  age: 'When each file first appeared in the project.',
  churn:
    'How much a file has been rewritten: every line added or removed across its whole life, added up.',
  type: 'What kind of file it is, worked out from its name and extension.',
};

const LUT_N = 64;

function ramp(stops: string[], domain?: number[]): string[] {
  const d = domain ?? stops.map((_, i) => i / (stops.length - 1));
  const scale = scaleLinear<string>().domain(d).range(stops).interpolate(interpolateRgb);
  const out: string[] = [];
  for (let i = 0; i < LUT_N; i++) out.push(scale(i / (LUT_N - 1)));
  return out;
}

/** Relative luminance, for choosing an ink that will be readable on a cell. */
export function luminance(hex: string): number {
  const h = hex.trim();
  const parse = (i: number) =>
    h.length === 4 ? parseInt(h[i / 2 + 1]! + h[i / 2 + 1]!, 16) : parseInt(h.slice(i + 1, i + 3), 16);
  const srgb = [parse(0), parse(2), parse(4)].map((c) => {
    const v = (Number.isNaN(c) ? 128 : c) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0]! + 0.7152 * srgb[1]! + 0.0722 * srgb[2]!;
}

/** Above this, a cell needs dark ink; below it, light ink. */
const INK_SPLIT = 0.22;

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
  /** Inks for labels drawn on a cell, and which one each colour wants. */
  inkLight: string;
  inkDark: string;
  needsDarkInk: {
    activity: Uint8Array;
    age: Uint8Array;
    churn: Uint8Array;
    author: Uint8Array;
    type: Uint8Array;
  };
}

export function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();

  // Warm colours are pushed to the top of the activity ramp: at the latest
  // commit most files have been touched at some point, and if "touched once"
  // already reads as hot then nothing stands out.
  const activity = ramp(
    [v('--heat-0'), v('--heat-1'), v('--heat-2'), v('--heat-3'), v('--heat-4')],
    [0, 0.42, 0.68, 0.86, 1],
  );
  const age = ramp([v('--age-old'), v('--age-mid'), v('--age-new')]);
  const churn = ramp([v('--churn-0'), v('--churn-1'), v('--churn-2')]);
  const author = [
    v('--cat-1'), v('--cat-2'), v('--cat-3'), v('--cat-4'), v('--cat-5'),
    v('--cat-6'), v('--cat-7'), v('--cat-8'), v('--cat-9'), v('--cat-10'),
    v('--cat-rest'),
  ];
  const type = [
    v('--type-code'), v('--type-tests'), v('--type-docs'), v('--type-config'), v('--type-assets'),
  ];

  return {
    activity,
    age,
    churn,
    author,
    type,
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
    inkLight: v('--label-on-dark'),
    inkDark: v('--label-on-light'),
    needsDarkInk: {
      activity: inkMask(activity),
      age: inkMask(age),
      churn: inkMask(churn),
      author: inkMask(author),
      type: inkMask(type),
    },
  };
}

/** 1 where a colour is light enough that a label on it must be dark. */
function inkMask(colours: string[]): Uint8Array {
  const out = new Uint8Array(colours.length);
  for (let i = 0; i < colours.length; i++) out[i] = luminance(colours[i]!) > INK_SPLIT ? 1 : 0;
  return out;
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
  const t = Math.log1p(churn) / Math.log1p(maxChurn);
  return t > 1 ? 1 : t;
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

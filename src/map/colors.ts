import { scaleLinear } from 'd3-scale';
import { interpolateRgb } from 'd3-interpolate';

/**
 * Colour for the map, as lookup tables.
 *
 * Every mode resolves to an index into a 64-entry table built once per theme,
 * so drawing a cell is an array read: no interpolation, no string building and
 * no allocation in the frame loop.
 */

export const MODES = ['activity', 'author', 'age', 'type'] as const;
export type Mode = (typeof MODES)[number];

/*
 * Labels say what the colour means, not what the measure is called. "Activity"
 * is a word this project's authors use; nobody arriving at the map for the
 * first time knows it.
 */
export const MODE_LABELS: Record<Mode, string> = {
  activity: 'Recently changed',
  author: 'Who wrote it',
  age: 'How old',
  type: 'Kind of file',
};

/** One sentence, in the legend, saying what you are looking at. */
export const MODE_HINTS: Record<Mode, string> = {
  activity:
    'How recently each file changed, as of the date on the playhead. Files touched just now are brightest and fade as they go quiet.',
  author: 'Whoever has added the most lines to each file over its whole life.',
  age: 'When each file first appeared in the project.',
  type: 'What kind of file it is, worked out from its name and extension.',
};

const LUT_N = 64;

/** Text has to reach this against whatever it is drawn on (WCAG AA, section 11). */
export const MIN_CONTRAST = 4.5;

/**
 * Read any CSS colour a token or a d3 interpolation can produce.
 *
 * d3 hands back `rgb(r, g, b)` strings while the tokens are hex, and the ink
 * choice below depends on reading both. An unreadable colour throws rather than
 * falling back to a guess: an earlier version defaulted to mid-grey, which made
 * every interpolated shade look "dark" and put white labels on bright yellow.
 */
export function parseColour(css: string): [number, number, number] {
  const c = css.trim().toLowerCase();

  if (c.startsWith('#')) {
    const hex = c.length === 4 ? c.slice(1).replace(/./g, (d) => d + d) : c.slice(1, 7);
    if (/^[0-9a-f]{6}$/.test(hex)) {
      return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
    }
  }

  const fn = c.match(/^rgba?\(([^)]*)\)/);
  if (fn) {
    const parts = fn[1]!.split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      return parts.map((n) => Math.max(0, Math.min(255, Math.round(n)))) as [number, number, number];
    }
  }

  throw new Error(`Cannot read "${css}" as a colour`);
}

/** Relative luminance, per WCAG. */
export function luminance(css: string): number {
  const [r, g, b] = parseColour(css).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** How well the better of the two inks reads on a fill. */
function bestContrast(fill: string, inkDark: string, inkLight: string): number {
  return Math.max(contrastRatio(fill, inkDark), contrastRatio(fill, inkLight));
}

/**
 * Between very dark and very light there is a band of mid-tones where neither
 * a near-black nor a near-white label reaches the minimum. A smooth ramp has to
 * cross it, and a cell that lands inside it would have unreadable text.
 *
 * Each shade in the band borrows its nearest readable neighbour instead. The
 * ramp stays visually continuous, since the band is only a few of 64 steps wide,
 * but no cell can ever end up with a label that cannot be read.
 */
function makeLegible(lut: string[], inkDark: string, inkLight: string): string[] {
  const ok = lut.map((c) => bestContrast(c, inkDark, inkLight) >= MIN_CONTRAST);
  return lut.map((c, i) => {
    if (ok[i]) return c;
    for (let d = 1; d < lut.length; d++) {
      if (i - d >= 0 && ok[i - d]) return lut[i - d]!;
      if (i + d < lut.length && ok[i + d]) return lut[i + d]!;
    }
    return c;
  });
}

function ramp(stops: string[], inks: [string, string], domain?: number[]): string[] {
  const d = domain ?? stops.map((_, i) => i / (stops.length - 1));
  const scale = scaleLinear<string>().domain(d).range(stops).interpolate(interpolateRgb);
  const out: string[] = [];
  for (let i = 0; i < LUT_N; i++) out.push(scale(i / (LUT_N - 1)));
  return makeLegible(out, inks[0], inks[1]);
}

export interface Palette {
  activity: string[];
  age: string[];
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
  /** Inks for labels drawn on a cell, and which one each colour wants. */
  inkLight: string;
  inkDark: string;
  needsDarkInk: {
    activity: Uint8Array;
    age: Uint8Array;
    author: Uint8Array;
    type: Uint8Array;
  };
}

export function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  return buildPalette((name) => cs.getPropertyValue(name).trim(), el.dataset.theme ?? 'night');
}

/**
 * The palette for one theme, from a function that looks tokens up by name.
 * Kept free of the DOM so a test can build exactly what the renderer builds,
 * from the real stylesheet, and check every colour a cell can be.
 */
export function buildPalette(v: (token: string) => string, theme: string): Palette {
  const inkDark = v('--label-on-light');
  const inkLight = v('--label-on-dark');
  const inks: [string, string] = [inkDark, inkLight];

  // Warm colours are pushed to the top of the activity ramp: at the latest
  // commit most files have been touched at some point, and if "touched once"
  // already reads as hot then nothing stands out.
  const activity = ramp(
    [v('--heat-0'), v('--heat-1'), v('--heat-2'), v('--heat-3'), v('--heat-4')],
    inks,
    [0, 0.42, 0.68, 0.86, 1],
  );
  const age = ramp([v('--age-old'), v('--age-mid'), v('--age-new')], inks);
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
    dark: theme !== 'paper',
    hot: v('--heat-4'),
    fresh: v('--accent'),
    ghost: v('--danger'),
    inkLight,
    inkDark,
    needsDarkInk: {
      activity: inkMask(activity, inkDark, inkLight),
      age: inkMask(age, inkDark, inkLight),
      author: inkMask(author, inkDark, inkLight),
      type: inkMask(type, inkDark, inkLight),
    },
  };
}

/** 1 where dark ink reads better on a colour than light ink does. */
function inkMask(colours: string[], inkDark: string, inkLight: string): Uint8Array {
  const out = new Uint8Array(colours.length);
  for (let i = 0; i < colours.length; i++) {
    out[i] = contrastRatio(colours[i]!, inkDark) >= contrastRatio(colours[i]!, inkLight) ? 1 : 0;
  }
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

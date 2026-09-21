import type { LayoutPayload, Tables } from '../lib/protocol';
import {
  activityT,
  ageT,
  lutIndex,
  type Mode,
  type Palette,
} from './colors';

/**
 * Canvas renderer for the map.
 *
 * Two layers: a base of cells and folder borders, and an overlay for hover,
 * selection and glows. Nothing here allocates per frame — the scratch arrays
 * are grown once and reused, colours come from lookup tables, and glows are a
 * pre-rendered sprite drawn with additive blending rather than shadowBlur.
 */

export interface Camera {
  /** Maps layout coordinates to canvas pixels: x' = x * k + tx. */
  k: number;
  tx: number;
  ty: number;
}

export const IDENTITY: Camera = { k: 1, tx: 0, ty: 0 };

/** Camera that makes `rect` fill a width x height canvas. */
export function cameraForRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  height: number,
): Camera {
  const k = Math.min(width / Math.max(1, x1 - x0), height / Math.max(1, y1 - y0));
  return { k, tx: -x0 * k, ty: -y0 * k };
}

export function lerpCamera(a: Camera, b: Camera, t: number): Camera {
  return {
    k: a.k + (b.k - a.k) * t,
    tx: a.tx + (b.tx - a.tx) * t,
    ty: a.ty + (b.ty - a.ty) * t,
  };
}

/**
 * One frame's subject: the layout being drawn, and optionally the layout it is
 * arriving from. Cells present in both slide and resize; cells only in `next`
 * pop in; cells only in `prev` collapse to a ghost outline.
 */
export interface Frame {
  next: LayoutPayload;
  prev: LayoutPayload | null;
  /** For each cell of `next`, its index in `prev`, or -1 when it is new. */
  prevOfNext: Int32Array | null;
  /** Indices in `prev` that are gone from `next`. */
  gone: Int32Array | null;
  goneCount: number;
  /** Eased progress, 0 to 1. */
  e: number;
}

/** The smallest a cell can get before it is folded into its parent's fill. */
const MIN_CELL = 0.75;
const MAX_GLOWS = 200;
const LABEL_FOLDER_MIN_W = 64;
const LABEL_FILE_MIN_W = 46;
const LABEL_FILE_MIN_H = 18;

export class MapRenderer {
  private glowOrder = new Int32Array(0);
  private glowScore = new Float32Array(0);
  private sprite: HTMLCanvasElement | null = null;
  private spriteColor = '';

  /** Colour index for cell i under the current mode. */
  private cellColor(
    l: LayoutPayload,
    i: number,
    mode: Mode,
    pal: Palette,
    tables: Tables,
    from: number,
    to: number,
  ): string {
    switch (mode) {
      case 'activity':
        return pal.activity[lutIndex(activityT(l.heat[i]!))]!;
      case 'author':
        return pal.author[tables.authorSlot[l.author[i]!] ?? 10]!;
      case 'age':
        return pal.age[lutIndex(ageT(l.firstTime[i]!, from, to))]!;
      case 'type':
        return pal.type[l.type[i]!] ?? pal.type[0]!;
    }
  }

  /** The ink a label on cell i must use to stay readable on its own colour. */
  private cellInk(
    l: LayoutPayload,
    i: number,
    mode: Mode,
    pal: Palette,
    tables: Tables,
    from: number,
    to: number,
  ): string {
    const mask = pal.needsDarkInk;
    let light: number;
    switch (mode) {
      case 'activity':
        light = mask.activity[lutIndex(activityT(l.heat[i]!))]!;
        break;
      case 'author':
        light = mask.author[tables.authorSlot[l.author[i]!] ?? 10]!;
        break;
      case 'age':
        light = mask.age[lutIndex(ageT(l.firstTime[i]!, from, to))]!;
        break;
      case 'type':
        light = mask.type[l.type[i]!] ?? 0;
        break;
    }
    return light === 1 ? pal.inkDark : pal.inkLight;
  }

  drawBase(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    opts: {
      mode: Mode;
      pal: Palette;
      tables: Tables;
      camera: Camera;
      width: number;
      height: number;
      from: number;
      to: number;
      alpha: number;
      dimmed: Uint8Array | null;
      labels: boolean;
    },
  ): void {
    const { pal, camera, mode, tables, from, to } = opts;
    const { k, tx, ty } = camera;
    const l = frame.next;
    const moving = frame.prev !== null && frame.e < 1;
    const e = frame.e;

    ctx.globalAlpha = opts.alpha;

    // Folder bodies first, so cells below the minimum size merge into one flat
    // fill instead of disappearing or shimmering.
    ctx.fillStyle = pal.dust;
    const fr = l.folderRects;
    for (let i = 0; i < l.folderDepth.length; i++) {
      const x0 = fr[i * 4]! * k + tx;
      const y0 = fr[i * 4 + 1]! * k + ty;
      const w = (fr[i * 4 + 2]! - fr[i * 4]!) * k;
      const h = (fr[i * 4 + 3]! - fr[i * 4 + 1]!) * k;
      if (w < 2 || h < 2) continue;
      if (x0 > opts.width || y0 > opts.height || x0 + w < 0 || y0 + h < 0) continue;
      ctx.fillRect(x0, y0, w, h);
    }

    // Files that have gone: collapse toward their centre and fade to an
    // outline, so a deletion reads as a departure rather than a blink.
    if (moving && frame.gone && frame.prev) {
      const pr = frame.prev.rects;
      ctx.strokeStyle = pal.ghost;
      ctx.lineWidth = 1;
      for (let g = 0; g < frame.goneCount; g++) {
        const i = frame.gone[g]!;
        const cx = ((pr[i * 4]! + pr[i * 4 + 2]!) / 2) * k + tx;
        const cy = ((pr[i * 4 + 1]! + pr[i * 4 + 3]!) / 2) * k + ty;
        const w = (pr[i * 4 + 2]! - pr[i * 4]!) * k * (1 - e);
        const h = (pr[i * 4 + 3]! - pr[i * 4 + 1]!) * k * (1 - e);
        if (w < 1.5 || h < 1.5) continue;
        ctx.globalAlpha = opts.alpha * (1 - e) * 0.9;
        ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
      }
      ctx.globalAlpha = opts.alpha;
    }

    const r = l.rects;
    const pr = frame.prev?.rects;
    const pon = frame.prevOfNext;
    const n = l.fileIds.length;
    for (let i = 0; i < n; i++) {
      let x0: number;
      let y0: number;
      let w: number;
      let h: number;
      let fresh = 0;

      const p = moving && pon ? pon[i]! : -1;
      if (p >= 0 && pr) {
        // Survivor: slide and resize from where it was.
        const ax0 = pr[p * 4]! + (r[i * 4]! - pr[p * 4]!) * e;
        const ay0 = pr[p * 4 + 1]! + (r[i * 4 + 1]! - pr[p * 4 + 1]!) * e;
        const ax1 = pr[p * 4 + 2]! + (r[i * 4 + 2]! - pr[p * 4 + 2]!) * e;
        const ay1 = pr[p * 4 + 3]! + (r[i * 4 + 3]! - pr[p * 4 + 3]!) * e;
        x0 = ax0 * k + tx;
        y0 = ay0 * k + ty;
        w = (ax1 - ax0) * k;
        h = (ay1 - ay0) * k;
      } else if (moving && pon) {
        // New file: grow from 0.6 of its size, with a brief flash.
        const cx = (r[i * 4]! + r[i * 4 + 2]!) / 2;
        const cy = (r[i * 4 + 1]! + r[i * 4 + 3]!) / 2;
        const scale = 0.6 + 0.4 * e;
        const hw = ((r[i * 4 + 2]! - r[i * 4]!) / 2) * scale;
        const hh = ((r[i * 4 + 3]! - r[i * 4 + 1]!) / 2) * scale;
        x0 = (cx - hw) * k + tx;
        y0 = (cy - hh) * k + ty;
        w = hw * 2 * k;
        h = hh * 2 * k;
        fresh = 1 - e;
      } else {
        x0 = r[i * 4]! * k + tx;
        y0 = r[i * 4 + 1]! * k + ty;
        w = (r[i * 4 + 2]! - r[i * 4]!) * k;
        h = (r[i * 4 + 3]! - r[i * 4 + 1]!) * k;
      }

      if (w < MIN_CELL || h < MIN_CELL) continue;
      if (x0 > opts.width || y0 > opts.height || x0 + w < 0 || y0 + h < 0) continue;
      ctx.globalAlpha = opts.dimmed && opts.dimmed[i] === 1 ? opts.alpha * 0.18 : opts.alpha;
      ctx.fillStyle =
        fresh > 0.35 ? pal.fresh : this.cellColor(l, i, mode, pal, tables, from, to);
      ctx.fillRect(x0, y0, w, h);
    }
    ctx.globalAlpha = opts.alpha;

    // Folder borders, drawn after the fills so regions read as regions.
    ctx.strokeStyle = pal.folderLine;
    ctx.lineWidth = 1;
    for (let i = 0; i < l.folderDepth.length; i++) {
      const x0 = fr[i * 4]! * k + tx;
      const y0 = fr[i * 4 + 1]! * k + ty;
      const w = (fr[i * 4 + 2]! - fr[i * 4]!) * k;
      const h = (fr[i * 4 + 3]! - fr[i * 4 + 1]!) * k;
      if (w < 12 || h < 12) continue;
      if (x0 > opts.width || y0 > opts.height || x0 + w < 0 || y0 + h < 0) continue;
      ctx.globalAlpha = opts.alpha * (l.folderDepth[i]! === 1 ? 0.9 : 0.45);
      ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
    }
    ctx.globalAlpha = opts.alpha;

    // Labels ride along with the tween rather than disappearing during
    // playback, which would leave the map anonymous exactly when it is moving.
    if (opts.labels) {
      this.drawLabels(ctx, frame, tables, pal, camera, opts, mode, from, to);
    }
  }

  private drawLabels(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    tables: Tables,
    pal: Palette,
    camera: Camera,
    opts: { width: number; height: number; alpha: number },
    mode: Mode,
    from: number,
    to: number,
  ): void {
    const { width, height, alpha } = opts;
    const { k, tx, ty } = camera;
    const l = frame.next;
    const moving = frame.prev !== null && frame.e < 1;
    ctx.textBaseline = 'middle';

    // Folder names, in the gutter the layout reserved for them.
    ctx.font = '700 10px Inter, sans-serif';
    ctx.fillStyle = pal.labelStrong;
    ctx.letterSpacing = '0.08em';
    const fr = l.folderRects;
    for (let i = 0; i < l.folderDepth.length; i++) {
      const x0 = fr[i * 4]! * k + tx;
      const y0 = fr[i * 4 + 1]! * k + ty;
      const w = (fr[i * 4 + 2]! - fr[i * 4]!) * k;
      const h = (fr[i * 4 + 3]! - fr[i * 4 + 1]!) * k;
      if (w < LABEL_FOLDER_MIN_W || h < 44) continue;
      if (x0 > width || y0 > height || x0 + w < 0 || y0 + h < 0) continue;
      const name = l.folderNames[i]!;
      ctx.globalAlpha = alpha * (l.folderDepth[i]! === 1 ? 0.95 : 0.6);
      ctx.fillText(fit(ctx, name.toUpperCase(), w - 10), x0 + 5, y0 + 8);
    }
    ctx.letterSpacing = '0px';

    // File names only once a cell is big enough to hold one. The ink is chosen
    // per cell: a fixed grey disappears on a hot yellow cell and on a dark one.
    ctx.font = '600 10px Inter, sans-serif';
    ctx.globalAlpha = alpha * 0.92;
    const r = l.rects;
    const pr = frame.prev?.rects;
    const pon = frame.prevOfNext;
    const e = frame.e;
    for (let i = 0; i < l.fileIds.length; i++) {
      let x0 = r[i * 4]!;
      let y0 = r[i * 4 + 1]!;
      let x1 = r[i * 4 + 2]!;
      let y1 = r[i * 4 + 3]!;
      if (moving && pon && pr) {
        const p = pon[i]!;
        if (p < 0) continue; // a file appearing is too brief to label
        x0 = pr[p * 4]! + (x0 - pr[p * 4]!) * e;
        y0 = pr[p * 4 + 1]! + (y0 - pr[p * 4 + 1]!) * e;
        x1 = pr[p * 4 + 2]! + (x1 - pr[p * 4 + 2]!) * e;
        y1 = pr[p * 4 + 3]! + (y1 - pr[p * 4 + 3]!) * e;
      }
      const w = (x1 - x0) * k;
      const h = (y1 - y0) * k;
      if (w < LABEL_FILE_MIN_W || h < LABEL_FILE_MIN_H) continue;
      const px = x0 * k + tx;
      const py = y0 * k + ty;
      if (px > width || py > height || px + w < 0 || py + h < 0) continue;
      ctx.fillStyle = this.cellInk(l, i, mode, pal, tables, from, to);
      ctx.fillText(fit(ctx, baseName(tables.paths[l.pathIds[i]!]!), w - 8), px + 4, py + h / 2);
    }
    ctx.globalAlpha = alpha;
  }

  /**
   * Overlay: glows for the hottest cells, then hover and selection.
   * Cleared and redrawn independently of the base layer.
   */
  drawOverlay(
    ctx: CanvasRenderingContext2D,
    l: LayoutPayload,
    opts: {
      pal: Palette;
      camera: Camera;
      width: number;
      height: number;
      hover: number;
      selected: number;
      hoverFolder: number;
      glows: boolean;
    },
  ): void {
    const { pal, camera } = opts;
    const { k, tx, ty } = camera;
    ctx.clearRect(0, 0, opts.width, opts.height);

    if (opts.glows) this.drawGlows(ctx, l, pal, camera, opts.width, opts.height);

    const r = l.rects;
    if (opts.hoverFolder >= 0) {
      const fr = l.folderRects;
      const i = opts.hoverFolder;
      ctx.strokeStyle = pal.glow;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.9;
      ctx.strokeRect(
        fr[i * 4]! * k + tx + 1,
        fr[i * 4 + 1]! * k + ty + 1,
        (fr[i * 4 + 2]! - fr[i * 4]!) * k - 2,
        (fr[i * 4 + 3]! - fr[i * 4 + 1]!) * k - 2,
      );
      ctx.globalAlpha = 1;
    }

    if (opts.hover >= 0) {
      const i = opts.hover;
      ctx.strokeStyle = pal.glow;
      ctx.lineWidth = 2;
      ctx.strokeRect(
        r[i * 4]! * k + tx - 1,
        r[i * 4 + 1]! * k + ty - 1,
        (r[i * 4 + 2]! - r[i * 4]!) * k + 2,
        (r[i * 4 + 3]! - r[i * 4 + 1]!) * k + 2,
      );
    }

    if (opts.selected >= 0) {
      const i = opts.selected;
      const x = r[i * 4]! * k + tx;
      const y = r[i * 4 + 1]! * k + ty;
      const w = (r[i * 4 + 2]! - r[i * 4]!) * k;
      const h = (r[i * 4 + 3]! - r[i * 4 + 1]!) * k;
      ctx.strokeStyle = pal.selection;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
      // A second, dark ring so selection survives on a light cell too.
      ctx.strokeStyle = pal.void;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 3.5, y - 3.5, w + 7, h + 7);
    }
  }

  private drawGlows(
    ctx: CanvasRenderingContext2D,
    l: LayoutPayload,
    pal: Palette,
    camera: Camera,
    width: number,
    height: number,
  ): void {
    if (this.sprite === null || this.spriteColor !== pal.glow) {
      this.sprite = makeSprite(pal.glow);
      this.spriteColor = pal.glow;
    }
    const n = l.heat.length;
    if (this.glowOrder.length < n) {
      this.glowOrder = new Int32Array(n);
      this.glowScore = new Float32Array(n);
    }

    // Partial selection of the hottest visible cells: one pass to collect,
    // then a bounded insertion into a small top-N list.
    const order = this.glowOrder;
    const score = this.glowScore;
    let count = 0;
    const r = l.rects;
    const { k, tx, ty } = camera;
    for (let i = 0; i < n; i++) {
      const h = l.heat[i]!;
      // Only genuinely hot cells glow; a glow on every touched file is fog.
      if (h < 1.2) continue;
      const x0 = r[i * 4]! * k + tx;
      const y0 = r[i * 4 + 1]! * k + ty;
      if (x0 > width || y0 > height || x0 + (r[i * 4 + 2]! - r[i * 4]!) * k < 0) continue;
      if (count < MAX_GLOWS) {
        order[count] = i;
        score[count] = h;
        count++;
      } else {
        let min = 0;
        for (let j = 1; j < MAX_GLOWS; j++) if (score[j]! < score[min]!) min = j;
        if (h > score[min]!) {
          order[min] = i;
          score[min] = h;
        }
      }
    }

    if (pal.dark) {
      ctx.globalCompositeOperation = 'lighter';
      const sprite = this.sprite;
      for (let j = 0; j < count; j++) {
        const i = order[j]!;
        const x0 = r[i * 4]! * k + tx;
        const y0 = r[i * 4 + 1]! * k + ty;
        const w = (r[i * 4 + 2]! - r[i * 4]!) * k;
        const h = (r[i * 4 + 3]! - r[i * 4 + 1]!) * k;
        const size = Math.max(w, h) * 1.6 + 10;
        ctx.globalAlpha = Math.min(0.2, 0.05 + score[j]! * 0.035);
        ctx.drawImage(sprite, x0 + w / 2 - size / 2, y0 + h / 2 - size / 2, size, size);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      return;
    }

    // On paper, an additive halo just washes the cell out. A hot ring reads as
    // deliberate rather than smudged, and survives printing.
    ctx.strokeStyle = pal.hot;
    ctx.lineWidth = 1.5;
    for (let j = 0; j < count; j++) {
      const i = order[j]!;
      const x0 = r[i * 4]! * k + tx;
      const y0 = r[i * 4 + 1]! * k + ty;
      const w = (r[i * 4 + 2]! - r[i * 4]!) * k;
      const h = (r[i * 4 + 3]! - r[i * 4 + 1]!) * k;
      if (w < 3 || h < 3) continue;
      ctx.globalAlpha = Math.min(0.85, 0.35 + score[j]! * 0.1);
      ctx.strokeRect(x0 + 0.75, y0 + 0.75, w - 1.5, h - 1.5);
    }
    ctx.globalAlpha = 1;
  }
}

function makeSprite(color: string, size = 128): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.35, `${color}66`);
  grad.addColorStop(1, 'transparent');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Truncate to the available width, reusing the context's measurement cache. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (max <= 0) return '';
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid)).width <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo > 1 ? `${text.slice(0, lo - 1)}…` : '';
}

/** Leaf name of a path, without allocating an array to get it. */
export function baseName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

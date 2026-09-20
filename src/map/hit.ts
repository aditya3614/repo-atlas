import type { Camera } from './render';
import type { LayoutPayload } from '../lib/protocol';

/**
 * Hit testing against the current layout.
 *
 * A uniform grid over the layout space keeps a pointer move O(cells in one
 * bucket) instead of O(all cells); at 20,000 files a linear scan on every
 * mousemove is the difference between a smooth hover and a sticky one.
 */

/** How far off a cell a pointer may be and still count as over it. */
const TOLERANCE = 3;

const COLS = 48;
const ROWS = 32;

export class HitGrid {
  private buckets: Int32Array[] = [];
  private w = 1;
  private h = 1;

  constructor(private layout: LayoutPayload) {
    this.rebuild(layout);
  }

  rebuild(layout: LayoutPayload): void {
    this.layout = layout;
    this.w = layout.width;
    this.h = layout.height;
    const counts = new Uint32Array(COLS * ROWS);
    const r = layout.rects;
    const n = layout.fileIds.length;

    const each = (i: number, fn: (b: number) => void) => {
      const c0 = clamp(Math.floor((r[i * 4]! / this.w) * COLS), 0, COLS - 1);
      const c1 = clamp(Math.floor((r[i * 4 + 2]! / this.w) * COLS), 0, COLS - 1);
      const r0 = clamp(Math.floor((r[i * 4 + 1]! / this.h) * ROWS), 0, ROWS - 1);
      const r1 = clamp(Math.floor((r[i * 4 + 3]! / this.h) * ROWS), 0, ROWS - 1);
      for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) fn(y * COLS + x);
    };

    for (let i = 0; i < n; i++) each(i, (b) => counts[b]!++);
    this.buckets = new Array(COLS * ROWS);
    for (let b = 0; b < COLS * ROWS; b++) this.buckets[b] = new Int32Array(counts[b]!);
    const cursor = new Uint32Array(COLS * ROWS);
    for (let i = 0; i < n; i++) each(i, (b) => (this.buckets[b]![cursor[b]!++] = i));
  }

  /**
   * Cell index under a point in layout space, or -1.
   *
   * The layout leaves a 1px gap between cells and a label gutter above each
   * folder, so an exact containment test leaves dead seams all over the map.
   * A miss falls back to the nearest cell within a few pixels.
   */
  cellAt(x: number, y: number): number {
    if (x < -TOLERANCE || y < -TOLERANCE || x > this.w + TOLERANCE || y > this.h + TOLERANCE) {
      return -1;
    }
    const col = clamp(Math.floor((x / this.w) * COLS), 0, COLS - 1);
    const row = clamp(Math.floor((y / this.h) * ROWS), 0, ROWS - 1);
    const r = this.layout.rects;

    let best = -1;
    let bestDist = TOLERANCE * TOLERANCE;
    for (let ry = Math.max(0, row - 1); ry <= Math.min(ROWS - 1, row + 1); ry++) {
      for (let rx = Math.max(0, col - 1); rx <= Math.min(COLS - 1, col + 1); rx++) {
        const bucket = this.buckets[ry * COLS + rx];
        if (!bucket) continue;
        // Later cells are deeper in the tree, so the last exact match wins.
        for (let j = bucket.length - 1; j >= 0; j--) {
          const i = bucket[j]!;
          const x0 = r[i * 4]!;
          const y0 = r[i * 4 + 1]!;
          const x1 = r[i * 4 + 2]!;
          const y1 = r[i * 4 + 3]!;
          if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return i;
          const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
          const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
          const d = dx * dx + dy * dy;
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
        }
      }
    }
    return best;
  }

  /**
   * The folder whose label gutter is under the point. Clicking a folder's
   * label is what drills into it; clicking a file selects it.
   */
  folderLabelAt(x: number, y: number): number {
    const fr = this.layout.folderRects;
    let best = -1;
    let bestDepth = -1;
    for (let i = 0; i < this.layout.folderDepth.length; i++) {
      const x0 = fr[i * 4]!;
      const y0 = fr[i * 4 + 1]!;
      const x1 = fr[i * 4 + 2]!;
      const y1 = fr[i * 4 + 3]!;
      if (x < x0 || x > x1 || y < y0 || y > y0 + 15) continue;
      if (x1 - x0 < 64 || y1 - y0 < 44) continue;
      const d = this.layout.folderDepth[i]!;
      if (d > bestDepth) {
        bestDepth = d;
        best = i;
      }
    }
    return best;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Canvas pixels to layout space. */
export function toLayout(cam: Camera, px: number, py: number): [number, number] {
  return [(px - cam.tx) / cam.k, (py - cam.ty) / cam.k];
}

import type { LayoutPayload, Tables } from '../lib/protocol';
import { HitGrid, toLayout } from './hit';
import { MapRenderer, IDENTITY, cameraForRect, lerpCamera, type Camera } from './render';
import type { Mode, Palette } from './colors';

/**
 * Owns the two canvases, the render loop and all pointer state.
 *
 * Deliberately outside React: hover and playback must not re-render the tree,
 * and the loop has to be able to stop dead when nothing is changing, so an
 * idle map costs no CPU.
 */

export interface MapCallbacks {
  onHoverCell: (index: number, clientX: number, clientY: number) => void;
  onHoverFolder: (index: number) => void;
  onSelect: (index: number) => void;
  onDrill: (path: string) => void;
}

const ZOOM_MS = 380;
const EASE = (t: number) => 1 - Math.pow(1 - t, 3);

export class MapController {
  private base: HTMLCanvasElement | null = null;
  private overlay: HTMLCanvasElement | null = null;
  private baseCtx: CanvasRenderingContext2D | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;

  private layout: LayoutPayload | null = null;
  private grid: HitGrid | null = null;
  private renderer = new MapRenderer();

  private pal: Palette | null = null;
  private tables: Tables | null = null;
  private mode: Mode = 'activity';
  private range: [number, number] = [0, 1];
  private dimmed: Uint8Array | null = null;

  hover = -1;
  hoverFolder = -1;
  selected = -1;

  private width = 1;
  private height = 1;
  private raf = 0;
  private baseDirty = true;
  private overlayDirty = true;

  /** Zoom transition state; null when the map is at rest. */
  private zoom: {
    prev: LayoutPayload;
    prevFrom: Camera;
    prevTo: Camera;
    nextFrom: Camera;
    start: number;
    dur: number;
  } | null = null;

  reducedMotion = false;

  constructor(private readonly cb: MapCallbacks) {}

  attach(base: HTMLCanvasElement, overlay: HTMLCanvasElement): void {
    this.base = base;
    this.overlay = overlay;
    this.baseCtx = base.getContext('2d', { alpha: false });
    this.overlayCtx = overlay.getContext('2d');
  }

  detach(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.base = this.overlay = null;
    this.baseCtx = this.overlayCtx = null;
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    for (const c of [this.base, this.overlay]) {
      if (!c) continue;
      c.width = Math.max(1, Math.round(width * dpr));
      c.height = Math.max(1, Math.round(height * dpr));
    }
    this.baseCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.overlayCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.invalidate(true);
  }

  setPalette(pal: Palette): void {
    this.pal = pal;
    this.invalidate(true);
  }

  setTables(tables: Tables): void {
    this.tables = tables;
    this.invalidate(true);
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.invalidate(true);
  }

  setTimeRange(from: number, to: number): void {
    this.range = [from, to];
    this.invalidate(true);
  }

  setDimmed(mask: Uint8Array | null): void {
    this.dimmed = mask;
    this.invalidate(true);
  }

  currentLayout(): LayoutPayload | null {
    return this.layout;
  }

  /**
   * Install a new layout. `zoomFrom` is the folder rectangle the view is
   * drilling into (or out of), which drives the transition.
   */
  setLayout(next: LayoutPayload, zoomFrom?: { rect: [number, number, number, number]; into: boolean }): void {
    const prev = this.layout;
    this.layout = next;
    if (this.grid) this.grid.rebuild(next);
    else this.grid = new HitGrid(next);
    this.hover = -1;
    this.hoverFolder = -1;

    if (prev && zoomFrom && !this.reducedMotion) {
      const [x0, y0, x1, y1] = zoomFrom.rect;
      const into = cameraForRect(x0, y0, x1, y1, this.width, this.height);
      const shrunk = shrinkTo(x0, y0, x1, y1, this.width, this.height);
      this.zoom = zoomFrom.into
        ? { prev, prevFrom: IDENTITY, prevTo: into, nextFrom: shrunk, start: performance.now(), dur: ZOOM_MS }
        : { prev, prevFrom: IDENTITY, prevTo: shrunk, nextFrom: into, start: performance.now(), dur: ZOOM_MS };
    } else {
      this.zoom = null;
    }
    this.invalidate(true);
  }

  invalidate(base = false): void {
    if (base) this.baseDirty = true;
    this.overlayDirty = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.raf !== 0) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  /** One frame. Returns without rescheduling once everything is settled. */
  private frame = (now: number): void => {
    this.raf = 0;
    const l = this.layout;
    const ctx = this.baseCtx;
    const octx = this.overlayCtx;
    if (!l || !ctx || !octx || !this.pal || !this.tables) return;

    let animating = false;
    let camera: Camera = IDENTITY;

    if (this.zoom) {
      const p = Math.min(1, (now - this.zoom.start) / this.zoom.dur);
      const e = EASE(p);
      animating = p < 1;
      camera = lerpCamera(this.zoom.nextFrom, IDENTITY, e);

      ctx.fillStyle = this.pal.void;
      ctx.fillRect(0, 0, this.width, this.height);
      // The outgoing map keeps moving under the incoming one, so the two read
      // as one continuous camera move rather than a cut.
      this.drawBase(ctx, this.zoom.prev, lerpCamera(this.zoom.prevFrom, this.zoom.prevTo, e), 1 - e, false);
      this.drawBase(ctx, l, camera, e, e > 0.6);
      octx.clearRect(0, 0, this.width, this.height);
      if (!animating) this.zoom = null;
      this.baseDirty = !animating;
    } else if (this.baseDirty) {
      ctx.fillStyle = this.pal.void;
      ctx.fillRect(0, 0, this.width, this.height);
      this.drawBase(ctx, l, IDENTITY, 1, true);
      this.baseDirty = false;
      this.overlayDirty = true;
    }

    if (!animating && this.overlayDirty) {
      this.renderer.drawOverlay(octx, l, {
        pal: this.pal,
        camera: IDENTITY,
        width: this.width,
        height: this.height,
        hover: this.hover,
        selected: this.selected,
        hoverFolder: this.hoverFolder,
        glows: this.mode === 'activity',
      });
      this.overlayDirty = false;
    }

    if (animating) this.schedule();
  };

  private drawBase(
    ctx: CanvasRenderingContext2D,
    l: LayoutPayload,
    camera: Camera,
    alpha: number,
    labels: boolean,
  ): void {
    this.renderer.drawBase(ctx, l, {
      mode: this.mode,
      pal: this.pal!,
      tables: this.tables!,
      camera,
      width: this.width,
      height: this.height,
      from: this.range[0],
      to: this.range[1],
      alpha,
      dimmed: this.dimmed,
      labels,
    });
  }

  // ---- pointer ----

  pointerMove(px: number, py: number, clientX: number, clientY: number): void {
    if (!this.grid || this.zoom) return;
    const [lx, ly] = toLayout(IDENTITY, px, py);
    const folder = this.grid.folderLabelAt(lx, ly);
    const cell = folder >= 0 ? -1 : this.grid.cellAt(lx, ly);
    if (cell !== this.hover || folder !== this.hoverFolder) {
      this.hover = cell;
      this.hoverFolder = folder;
      this.cb.onHoverCell(cell, clientX, clientY);
      this.cb.onHoverFolder(folder);
      this.invalidate();
    } else if (cell >= 0) {
      // Same cell, new position: only the tooltip needs to move.
      this.cb.onHoverCell(cell, clientX, clientY);
    }
  }

  pointerLeave(): void {
    if (this.hover !== -1 || this.hoverFolder !== -1) {
      this.hover = -1;
      this.hoverFolder = -1;
      this.cb.onHoverCell(-1, 0, 0);
      this.cb.onHoverFolder(-1);
      this.invalidate();
    }
  }

  click(): void {
    if (!this.layout) return;
    if (this.hoverFolder >= 0) {
      this.cb.onDrill(this.layout.folderPaths[this.hoverFolder]!);
      return;
    }
    this.selected = this.hover;
    this.cb.onSelect(this.hover);
    this.invalidate();
  }

  select(index: number): void {
    this.selected = index;
    this.invalidate();
  }

  /** Rectangle of a folder in the current layout, for the zoom transition. */
  folderRect(path: string): [number, number, number, number] | null {
    const l = this.layout;
    if (!l) return null;
    const i = l.folderPaths.indexOf(path);
    if (i < 0) return null;
    return [l.folderRects[i * 4]!, l.folderRects[i * 4 + 1]!, l.folderRects[i * 4 + 2]!, l.folderRects[i * 4 + 3]!];
  }
}

/** Camera that packs the whole canvas into `rect`, for the incoming layout. */
function shrinkTo(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  height: number,
): Camera {
  const k = Math.min((x1 - x0) / Math.max(1, width), (y1 - y0) / Math.max(1, height));
  return { k, tx: x0 + ((x1 - x0) - width * k) / 2, ty: y0 + ((y1 - y0) - height * k) / 2 };
}

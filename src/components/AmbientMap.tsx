import { useEffect, useRef } from 'react';
import { hierarchy, treemap, treemapSquarify, type HierarchyRectangularNode } from 'd3-hierarchy';
import { scaleLinear } from 'd3-scale';
import { interpolateRgb } from 'd3-interpolate';
import { mulberry32 } from '../lib/prng';
import { usePrefersReducedMotion } from '../lib/motion';
import { useUi } from '../store/ui';

/**
 * The landing backdrop: a fake repository drawn with the same treemap machinery
 * the real map uses, so the landing already shows what the product looks like.
 * It carries no data and never touches the network.
 */

interface Node {
  name: string;
  children?: Node[];
  value?: number;
  /** 0..1 baseline warmth; only the hot minority breathes. */
  heat?: number;
  phase?: number;
}

const FOLDERS = [
  'src', 'core', 'ui', 'lib', 'server', 'tests', 'docs', 'scripts', 'assets', 'api',
  'model', 'hooks', 'utils', 'types', 'config', 'workers', 'styles', 'pages',
];
const LEAVES = [
  'index', 'router', 'parser', 'model', 'store', 'view', 'utils', 'types', 'client',
  'worker', 'layout', 'theme', 'engine', 'cache', 'query', 'render', 'schema', 'auth',
];

function buildTree(seed: number): Node {
  const rnd = mulberry32(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;

  const leaves = (n: number): Node[] => {
    const out: Node[] = [];
    for (let k = 0; k < n; k++) {
      // Power-law sizes: many small files, a few large ones, like a real repo.
      const v = Math.pow(rnd(), 2.6) * 1200 + 25;
      const r = rnd();
      const hot = r < 0.09;
      const warm = !hot && r < 0.3;
      out.push({
        name: `${pick(LEAVES)}.ts`,
        value: v,
        heat: hot ? 0.72 + rnd() * 0.28 : warm ? 0.3 + rnd() * 0.25 : rnd() * 0.16,
        phase: rnd() * Math.PI * 2,
      });
    }
    return out;
  };

  const top: Node[] = [];
  const topCount = 9;
  for (let i = 0; i < topCount; i++) {
    const subs: Node[] = [];
    const subCount = 3 + Math.floor(rnd() * 4);
    for (let j = 0; j < subCount; j++) {
      // A third of the regions nest one level deeper, which breaks up the grain.
      if (rnd() < 0.35) {
        const inner: Node[] = [];
        for (let m = 0; m < 2 + Math.floor(rnd() * 3); m++) {
          inner.push({ name: pick(FOLDERS), children: leaves(6 + Math.floor(rnd() * 22)) });
        }
        subs.push({ name: pick(FOLDERS), children: inner });
      } else {
        subs.push({ name: pick(FOLDERS), children: leaves(10 + Math.floor(rnd() * 34)) });
      }
    }
    top.push({ name: FOLDERS[i % FOLDERS.length]!, children: subs });
  }
  return { name: 'root', children: top };
}

interface Cell {
  x0: number; y0: number; x1: number; y1: number;
  heat: number;
  phase: number;
  /** Cold cells get a fixed tone so the map has grain when nothing is hot. */
  tone: number;
  name: string;
}

const HOT = 0.62;

function layout(width: number, height: number, seed: number) {
  const root = hierarchy<Node>(buildTree(seed))
    .sum((d) => d.value ?? 0)
    // Stable sibling order by name, never by size: cells must not jump around.
    .sort((a, b) => (a.data.name < b.data.name ? -1 : 1));

  treemap<Node>()
    .tile(treemapSquarify)
    .size([width, height])
    .paddingInner(1)
    .paddingOuter(2)
    .paddingTop(4)
    .round(true)(root as HierarchyRectangularNode<Node>);

  const rnd = mulberry32(seed ^ 0x9e37);
  const cells: Cell[] = [];
  const regions: Cell[] = [];
  (root as HierarchyRectangularNode<Node>).each((n) => {
    const c: Cell = {
      x0: n.x0, y0: n.y0, x1: n.x1, y1: n.y1,
      heat: n.data.heat ?? 0,
      phase: n.data.phase ?? 0,
      tone: 0.03 + rnd() * 0.1,
      name: n.data.name,
    };
    if (!n.children) cells.push(c);
    else if (n.depth === 1) regions.push(c);
  });
  return { cells, regions };
}

/** 64-entry colour LUT so no frame allocates an interpolator. */
function buildLut(stops: string[]): string[] {
  const scale = scaleLinear<string>()
    .domain([0, 0.25, 0.5, 0.75, 1])
    .range(stops)
    .interpolate(interpolateRgb);
  const lut: string[] = [];
  for (let i = 0; i < 64; i++) lut.push(scale(i / 63));
  return lut;
}

function readTokens(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    void: v('--map-void'),
    lut: buildLut([v('--heat-0'), v('--heat-1'), v('--heat-2'), v('--heat-3'), v('--heat-4')]),
    glow: v('--accent'),
    label: v('--text-faint'),
  };
}

/** Soft radial sprite, drawn additively. Cheaper and calmer than shadowBlur. */
function makeGlow(color: string): HTMLCanvasElement {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.45, color.startsWith('#') ? `${color}55` : color);
  grad.addColorStop(1, 'transparent');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

export function AmbientMap() {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();
  const theme = useUi((s) => s.theme);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const tokens = readTokens(document.documentElement);
    const glow = makeGlow(tokens.glow);
    let cells: Cell[] = [];
    let regions: Cell[] = [];
    let w = 0;
    let h = 0;
    let raf = 0;
    let last = 0;

    const draw = (t: number) => {
      ctx.fillStyle = tokens.void;
      ctx.fillRect(0, 0, w, h);

      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]!;
        const cw = c.x1 - c.x0;
        const ch = c.y1 - c.y0;
        if (cw < 0.75 || ch < 0.75) continue;
        let warmth = c.tone + c.heat * 0.55;
        if (!reduced && c.heat > HOT) {
          warmth += 0.28 * (0.5 + 0.5 * Math.sin(t / 2800 + c.phase));
        } else if (c.heat > HOT) {
          warmth += 0.14;
        }
        if (warmth > 1) warmth = 1;
        ctx.fillStyle = tokens.lut[(warmth * 63) | 0]!;
        ctx.fillRect(c.x0, c.y0, cw, ch);
      }

      // Glows for the hot minority only.
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]!;
        if (c.heat <= HOT) continue;
        const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t / 2800 + c.phase);
        const cw = c.x1 - c.x0;
        const ch = c.y1 - c.y0;
        const r = Math.max(cw, ch) * 1.5;
        ctx.globalAlpha = 0.05 + 0.1 * pulse;
        ctx.drawImage(glow, (c.x0 + c.x1) / 2 - r / 2, (c.y0 + c.y1) / 2 - r / 2, r, r);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      // Region labels in small caps, the way the real map labels folders.
      ctx.font = '700 10px Inter, sans-serif';
      ctx.fillStyle = tokens.label;
      for (let i = 0; i < regions.length; i++) {
        const r = regions[i]!;
        if (r.x1 - r.x0 < 130 || r.y1 - r.y0 < 46) continue;
        ctx.globalAlpha = 0.75;
        ctx.fillText(r.name.toUpperCase(), r.x0 + 8, r.y0 + 16);
      }
      ctx.globalAlpha = 1;
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const out = layout(w, h, 20260921);
      cells = out.cells;
      regions = out.regions;
      draw(0);
    };

    const loop = (t: number) => {
      // ~30fps is plenty for a backdrop and keeps idle CPU low.
      if (t - last > 33) {
        draw(t);
        last = t;
      }
      raf = requestAnimationFrame(loop);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    if (!reduced) raf = requestAnimationFrame(loop);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [reduced, theme]);

  return <canvas ref={ref} className="ambient" aria-hidden="true" />;
}

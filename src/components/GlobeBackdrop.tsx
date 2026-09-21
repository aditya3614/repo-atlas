import { useEffect, useRef } from 'react';
import { mulberry32 } from '../lib/prng';
import { usePrefersReducedMotion } from '../lib/motion';
import { parseColour } from '../map/colors';
import { useUi } from '../store/ui';

/**
 * The landing backdrop: a handful of orbits that draw themselves when the page
 * loads and, crossing one another, make up a complete sphere. Once it is
 * drawn it turns slowly, with nodes riding the orbits like commits landing.
 *
 * Drawn rather than filmed so it costs a few kilobytes instead of a few
 * megabytes, scales to any viewport, and can hold still for anyone who asks
 * for reduced motion (which gets the finished globe straight away). It is
 * decoration, so it never reads or shows any data.
 */

/** Points sampled along each orbit. Enough that the curve reads as smooth. */
const STEPS = 128;
const RINGS = 9;
/** When the globe has finished drawing itself, in ms after the first frame. */
const INTRO_MS = 3400;

interface Ring {
  /** Unit-sphere points along the orbit, as x,y,z triples. */
  pts: Float32Array;
  /** When this orbit starts drawing, and how long it takes. */
  delay: number;
  dur: number;
  accent: boolean;
  /** One accent orbit also carries a soft filled disc, as in the reference. */
  filled: boolean;
  width: number;
}

const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

function buildRings(): Ring[] {
  const rnd = mulberry32(20260922);
  const rings: Ring[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < RINGS; i++) {
    // Normals spread evenly over the sphere (a Fibonacci spiral) keep the
    // orbits from bunching up; a little jitter stops them looking like a grid.
    const y = 1 - (2 * (i + 0.5)) / RINGS + (rnd() - 0.5) * 0.18;
    const rho = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * golden + (rnd() - 0.5) * 0.5;
    const n = [rho * Math.cos(phi), y, rho * Math.sin(phi)] as const;

    // Two axes lying in the orbit's plane.
    const h = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let u = [h[1]! * n[2] - h[2]! * n[1], h[2]! * n[0] - h[0]! * n[2], h[0]! * n[1] - h[1]! * n[0]];
    const ul = Math.hypot(u[0]!, u[1]!, u[2]!);
    u = u.map((c) => c / ul);
    const v = [
      n[1] * u[2]! - n[2] * u[1]!,
      n[2] * u[0]! - n[0] * u[2]!,
      n[0] * u[1]! - n[1] * u[0]!,
    ];

    // Some orbits are smaller circles, so the sphere is not all great circles.
    const r = i % 3 === 0 ? 1 : 0.8 + rnd() * 0.16;
    const lift = Math.sqrt(1 - r * r);
    const start = rnd() * Math.PI * 2;

    const pts = new Float32Array((STEPS + 1) * 3);
    for (let s = 0; s <= STEPS; s++) {
      const a = start + (s / STEPS) * Math.PI * 2;
      const c = Math.cos(a) * r;
      const d = Math.sin(a) * r;
      for (let k = 0; k < 3; k++) pts[s * 3 + k] = n[k]! * lift + u[k]! * c + v[k]! * d;
    }

    rings.push({
      pts,
      delay: 150 + i * 240,
      dur: 1700,
      accent: i === 1 || i === 5,
      filled: i === 1,
      width: 0.8 + rnd() * 0.5,
    });
  }
  return rings;
}

function buildNodes(rings: Ring[]) {
  const rnd = mulberry32(4242);
  const nodes: { ring: number; at: number; speed: number; phase: number; size: number }[] = [];
  rings.forEach((_ring, r) => {
    const count = 3 + Math.floor(rnd() * 3);
    for (let k = 0; k < count; k++) {
      nodes.push({
        ring: r,
        at: rnd(),
        speed: (0.008 + rnd() * 0.02) * (rnd() < 0.5 ? -1 : 1),
        phase: rnd() * Math.PI * 2,
        // Mostly specks, with the odd larger one, as in the reference.
        size: rnd() < 0.2 ? 2.6 + rnd() * 1.4 : 1 + rnd() * 1.2,
      });
    }
  });
  return nodes;
}

interface Tokens {
  line: string;
  accent: string;
  node: string;
  /** The accent as r,g,b, for the haze behind the globe. */
  accentRgb: string;
}

function readTokens(el: HTMLElement): Tokens {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  const accent = v('--globe-accent');
  let accentRgb = '240, 81, 143';
  try {
    accentRgb = parseColour(accent).join(', ');
  } catch {
    /* an unreadable token keeps the default haze */
  }
  return { line: v('--globe-line'), accent, node: v('--globe-node'), accentRgb };
}

export function GlobeBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();
  const theme = useUi((s) => s.theme);
  const tokens = useRef<Tokens | null>(null);

  // A theme change only recolours the globe; it must not replay the drawing.
  useEffect(() => {
    tokens.current = readTokens(document.documentElement);
  }, [theme]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rings = buildRings();
    const nodes = buildNodes(rings);
    tokens.current ??= readTokens(document.documentElement);

    let w = 0;
    let h = 0;
    let radius = 0;
    let raf = 0;
    let started = -1;
    let lastDrawn = -Infinity;
    let elapsed = reduced ? INTRO_MS + 1 : 0;

    // Scratch buffers: projecting an orbit allocates nothing per frame.
    const px = new Float32Array(STEPS + 1);
    const py = new Float32Array(STEPS + 1);
    const pz = new Float32Array(STEPS + 1);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      radius = Math.min(w * 0.4, h * 0.38, 228);
      draw();
    };

    const draw = () => {
      const tk = tokens.current!;
      ctx.clearRect(0, 0, w, h);
      if (radius <= 0) return;

      // Dead centre of the canvas, which the stylesheet lines up with the
      // headline, so the two sit on one horizontal axis.
      const cx = w * 0.5;
      const cy = h * 0.5;
      const intro = Math.min(1, elapsed / INTRO_MS);

      // The globe arrives turning and settles into a slow drift.
      const settle = 1 - easeOut(intro);
      const spin = reduced ? 0.6 : elapsed / 18000 - 1.4 * settle;
      const tilt = reduced ? -0.3 : -0.3 + Math.sin(elapsed / 23000) * 0.1;
      const cs = Math.cos(spin), ss = Math.sin(spin);
      const ct = Math.cos(tilt), st = Math.sin(tilt);

      // A soft haze behind the sphere, so it glows rather than floats.
      const haze = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 1.5);
      haze.addColorStop(0, `rgba(${tk.accentRgb}, 0.16)`);
      haze.addColorStop(0.6, `rgba(${tk.accentRgb}, 0.04)`);
      haze.addColorStop(1, `rgba(${tk.accentRgb}, 0)`);
      ctx.globalAlpha = easeOut(elapsed / 1400);
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, w, h);

      // A very faint edge, drawn first, so the orbits read as one sphere.
      const outline = easeOut(elapsed / 1400);
      if (outline > 0) {
        ctx.globalAlpha = 0.16;
        ctx.strokeStyle = tk.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * outline);
        ctx.stroke();
      }

      const project = (pts: Float32Array, i: number, out: number) => {
        const x = pts[i * 3]!;
        const y = pts[i * 3 + 1]!;
        const z = pts[i * 3 + 2]!;
        // Spin about Y, then tilt about X.
        const x2 = x * cs + z * ss;
        const z2 = -x * ss + z * cs;
        px[out] = cx + x2 * radius;
        py[out] = cy + (y * ct - z2 * st) * radius;
        pz[out] = y * st + z2 * ct;
      };

      for (const ring of rings) {
        const prog = easeOut((elapsed - ring.delay) / ring.dur);
        if (prog <= 0) continue;
        const n = Math.max(1, Math.floor(prog * STEPS));
        for (let i = 0; i <= n; i++) project(ring.pts, i, i);

        // The accent orbit's disc fades in once its outline is down.
        if (ring.filled && n === STEPS) {
          const fade = easeOut((elapsed - ring.delay - ring.dur) / 1000);
          if (fade > 0) {
            ctx.globalAlpha = 0.13 * fade;
            ctx.fillStyle = tk.accent;
            ctx.beginPath();
            ctx.moveTo(px[0]!, py[0]!);
            for (let i = 1; i <= STEPS; i++) ctx.lineTo(px[i]!, py[i]!);
            ctx.closePath();
            ctx.fill();
          }
        }

        // Short runs, so the far side of the sphere can fade out behind it.
        ctx.lineWidth = ring.width;
        ctx.strokeStyle = ring.accent ? tk.accent : tk.line;
        for (let i = 0; i < n; i++) {
          const depth = (pz[i]! + pz[i + 1]!) * 0.5;
          const alpha = 0.14 + 0.86 * Math.pow((depth + 1) / 2, 1.5);
          ctx.globalAlpha = alpha * (ring.accent ? 1 : 0.7);
          ctx.beginPath();
          ctx.moveTo(px[i]!, py[i]!);
          ctx.lineTo(px[i + 1]!, py[i + 1]!);
          ctx.stroke();
        }
      }

      // Nodes come in once the orbits are down, like commits landing.
      const nodeIn = easeOut((elapsed - INTRO_MS * 0.75) / 1000);
      if (nodeIn > 0) {
        for (const node of nodes) {
          const ring = rings[node.ring]!;
          const at = reduced ? node.at : node.at + (elapsed / 1000) * node.speed;
          const i = Math.min(STEPS, Math.floor((((at % 1) + 1) % 1) * STEPS));
          project(ring.pts, i, 0);
          const front = Math.pow((pz[0]! + 1) / 2, 1.6);
          const pulse = reduced ? 0.8 : 0.6 + 0.4 * Math.sin(elapsed / 1100 + node.phase);

          if (node.size > 2.4) {
            ctx.fillStyle = ring.accent ? tk.accent : tk.node;
            ctx.globalAlpha = 0.14 * front * pulse * nodeIn;
            ctx.beginPath();
            ctx.arc(px[0]!, py[0]!, node.size * 2.6, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = ring.accent ? tk.accent : tk.node;
          ctx.globalAlpha = (0.2 + 0.8 * front) * pulse * nodeIn * (ring.accent ? 1 : 0.85);
          ctx.beginPath();
          ctx.arc(px[0]!, py[0]!, node.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    const loop = (ts: number) => {
      if (started < 0) started = ts;
      elapsed = ts - started;
      // Full rate while it is drawing itself; 30fps is plenty for a slow turn
      // afterwards, and halves the idle cost.
      if (elapsed < INTRO_MS || ts - lastDrawn > 33) {
        draw();
        lastDrawn = ts;
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
  }, [reduced]);

  return <canvas ref={ref} className="globe" aria-hidden="true" />;
}

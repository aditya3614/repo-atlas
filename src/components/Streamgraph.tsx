import { useCallback, useEffect, useRef } from 'react';
import { stack, stackOffsetWiggle, stackOrderInsideOut, area, curveBasis } from 'd3-shape';
import { scaleLinear } from 'd3-scale';
import { SERIES } from '../worker/timeline';
import { clock, fraction, notifyClock, seekToFraction } from '../map/clock';
import type { Palette } from '../map/colors';
import type { TimelinePayload, Tables } from '../lib/protocol';
import { formatDate } from '../lib/format';

/**
 * Commits per week per author, stacked with a wiggle offset — and the scrubber.
 * Drawn on canvas and seeked by pointer; the playhead is repainted from the
 * clock, never from React state.
 */
export function Streamgraph({
  timeline,
  tables,
  pal,
  onSeek,
}: {
  timeline: TimelinePayload;
  tables: Tables;
  pal: Palette;
  onSeek: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<HTMLDivElement>(null);
  const shapeRef = useRef<Path2D[]>([]);
  const sizeRef = useRef({ w: 1, h: 1 });

  /** Rebuild the stacked areas; only needed on resize or a new history. */
  const build = useCallback(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    sizeRef.current = { w, h };

    const weeks = timeline.weeks;
    const rows: Record<string, number>[] = [];
    for (let i = 0; i < weeks; i++) {
      const row: Record<string, number> = {};
      for (let s = 0; s < SERIES; s++) row[`s${s}`] = timeline.series[s * weeks + i]!;
      rows.push(row);
    }

    const keys = Array.from({ length: SERIES }, (_, s) => `s${s}`);
    const stacked = stack<Record<string, number>>()
      .keys(keys)
      .offset(stackOffsetWiggle)
      .order(stackOrderInsideOut)(rows);

    /*
     * The wiggle offset minimises slope changes, but its baseline random-walks:
     * over 600-odd weeks the ribbon drifts far further than it is thick, and
     * fitting that whole range leaves a thread on an empty canvas. Subtracting
     * a heavily smoothed centre removes the long-range drift and keeps the
     * local wiggle that makes the shape readable.
     */
    const centre = new Float64Array(weeks);
    for (let i = 0; i < weeks; i++) {
      let lowest = Infinity;
      let highest = -Infinity;
      for (const layer of stacked) {
        if (layer[i]![0] < lowest) lowest = layer[i]![0];
        if (layer[i]![1] > highest) highest = layer[i]![1];
      }
      centre[i] = (lowest + highest) / 2;
    }
    const radius = Math.max(8, Math.round(weeks / 24));
    const smooth = new Float64Array(weeks);
    let running = 0;
    for (let i = 0; i < weeks; i++) {
      const lo0 = Math.max(0, i - radius);
      const hi0 = Math.min(weeks - 1, i + radius);
      if (i === 0) {
        running = 0;
        for (let j = lo0; j <= hi0; j++) running += centre[j]!;
        smooth[i] = running / (hi0 - lo0 + 1);
      } else {
        // Recompute at the edges only; the window slides everywhere else.
        let sum = 0;
        for (let j = lo0; j <= hi0; j++) sum += centre[j]!;
        smooth[i] = sum / (hi0 - lo0 + 1);
      }
    }
    for (let i = 0; i < weeks; i++) {
      for (const layer of stacked) {
        layer[i]![0] -= smooth[i]!;
        layer[i]![1] -= smooth[i]!;
      }
    }

    let lo = Infinity;
    let hi = -Infinity;
    for (const layer of stacked) {
      for (const p of layer) {
        if (p[0] < lo) lo = p[0];
        if (p[1] > hi) hi = p[1];
      }
    }
    if (!Number.isFinite(lo) || lo === hi) {
      lo = 0;
      hi = 1;
    }

    const x = scaleLinear().domain([0, Math.max(1, weeks - 1)]).range([0, w]);
    const y = scaleLinear().domain([lo, hi]).range([h - 2, 2]);
    const shape = area<[number, number] & { data: unknown }>()
      .x((_d, i) => x(i))
      .y0((d) => y(d[0]))
      .y1((d) => y(d[1]))
      .curve(curveBasis);

    shapeRef.current = stacked.map((layer) => {
      const path = shape(layer as never);
      return new Path2D(path ?? '');
    });
  }, [timeline]);

  /** Paint: the stack, the year ticks, then the playhead. */
  const paint = useCallback(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { w, h } = sizeRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const shapes = shapeRef.current;
    for (let s = 0; s < shapes.length; s++) {
      const author = timeline.seriesAuthors[s] ?? -1;
      ctx.fillStyle =
        author >= 0 ? pal.author[tables.authorSlot[author] ?? 10]! : pal.author[10]!;
      ctx.globalAlpha = author >= 0 ? 0.92 : 0.5;
      ctx.fill(shapes[s]!);
    }
    ctx.globalAlpha = 1;

    // Year ticks along the bottom.
    const first = new Date(timeline.weekStart).getUTCFullYear();
    const lastMs = timeline.weekStart + timeline.weeks * 7 * 86_400_000;
    const lastYear = new Date(lastMs).getUTCFullYear();
    ctx.font = '600 10px Inter, sans-serif';
    ctx.textBaseline = 'bottom';
    for (let yr = first + 1; yr <= lastYear; yr++) {
      const t = Date.UTC(yr, 0, 1);
      const frac = (t - timeline.weekStart) / (lastMs - timeline.weekStart);
      if (frac < 0 || frac > 1) continue;
      const px = frac * w;
      ctx.strokeStyle = pal.hairline;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
      ctx.fillStyle = pal.label;
      ctx.fillText(String(yr), px + 4, h - 2);
    }

    // Playhead.
    const px = fraction() * w;
    ctx.strokeStyle = pal.hot;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
    ctx.fillStyle = pal.hot;
    ctx.beginPath();
    ctx.arc(px, 6, 4, 0, Math.PI * 2);
    ctx.fill();
  }, [pal, tables, timeline]);

  useEffect(() => {
    build();
    paint();
    const canvas = ref.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      build();
      paint();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [build, paint]);

  // Repaint the playhead while the clock runs.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (clock.playing || clock.scrubbing) paint();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [paint]);

  const seekFromEvent = useCallback(
    (e: React.PointerEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      seekToFraction((e.clientX - rect.left) / rect.width);
      notifyClock();
      onSeek();
      paint();
    },
    [onSeek, paint],
  );

  return (
    <div className="stream">
      <canvas
        ref={ref}
        className="stream-canvas"
        role="slider"
        tabIndex={0}
        aria-label="Time. Commits per week by author; drag to move through the history."
        aria-valuemin={0}
        aria-valuemax={Math.max(0, clock.commits - 1)}
        aria-valuenow={clock.commit}
        aria-valuetext={formatDate(timeline.times[clock.commit] ?? 0)}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          clock.scrubbing = true;
          clock.playing = false;
          seekFromEvent(e);
        }}
        onPointerMove={(e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const frac = (e.clientX - rect.left) / rect.width;
          const tip = hoverRef.current;
          if (tip) {
            const week = Math.min(
              timeline.weeks - 1,
              Math.max(0, Math.round(frac * (timeline.weeks - 1))),
            );
            let total = 0;
            for (let s = 0; s < SERIES; s++) total += timeline.series[s * timeline.weeks + week]!;
            tip.style.transform = `translateX(${Math.max(0, frac * rect.width)}px)`;
            tip.textContent = `${formatDate(timeline.weekStart + week * 7 * 86_400_000)} · ${total} commit${total === 1 ? '' : 's'}`;
            tip.style.opacity = '1';
          }
          if (clock.scrubbing) seekFromEvent(e);
        }}
        onPointerUp={() => {
          clock.scrubbing = false;
          notifyClock();
        }}
        onPointerLeave={() => {
          const tip = hoverRef.current;
          if (tip) tip.style.opacity = '0';
        }}
      />
      <div ref={hoverRef} className="stream-tip tiny mono" aria-hidden="true" />
    </div>
  );
}

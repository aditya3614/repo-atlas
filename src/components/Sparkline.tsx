import { useEffect, useRef } from 'react';

/** Size over a file's life. Canvas, because there may be one per hover. */
export function Sparkline({
  values,
  width,
  height,
  playhead,
}: {
  values: Float32Array | null;
  width: number;
  height: number;
  playhead?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!values || values.length === 0) return;

    const cs = getComputedStyle(canvas);
    const line = cs.getPropertyValue('--accent').trim();
    const fill = cs.getPropertyValue('--accent-soft').trim();

    let max = 1;
    for (let i = 0; i < values.length; i++) if (values[i]! > max) max = values[i]!;
    const x = (i: number) => (values.length === 1 ? width / 2 : (i / (values.length - 1)) * width);
    const y = (v: number) => height - 1 - (v / max) * (height - 2);

    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let i = 0; i < values.length; i++) ctx.lineTo(x(i), y(values[i]!));
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < values.length; i++) {
      const px = x(i);
      const py = y(values[i]!);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = line;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (playhead !== undefined) {
      ctx.beginPath();
      ctx.moveTo(playhead * width, 0);
      ctx.lineTo(playhead * width, height);
      ctx.strokeStyle = cs.getPropertyValue('--warn').trim();
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }, [values, width, height, playhead]);

  return <canvas ref={ref} style={{ width, height }} className="spark" aria-hidden="true" />;
}

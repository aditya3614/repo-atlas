import { useEffect, useRef, useState } from 'react';
import { mulberry32 } from '../lib/prng';

/**
 * The band of columns along the bottom of the landing page.
 *
 * Measured off the reference recording rather than judged by eye: the columns
 * are equal width and touch each other, each is a straight fade from solid at
 * its base to nothing at its top, and their heights sway between about half
 * and full height on a twelve-second cycle, every column on its own phase.
 *
 * Each column is two elements: the outer one rises from the floor once, when
 * the page loads, and the inner one does the endless sway. Splitting them lets
 * both animate `transform` without fighting over it, and keeps the whole band
 * on the compositor — the main thread does nothing after the first paint.
 */

/** Column width in CSS pixels: 105 device pixels at 2x in the reference. */
const BAR_WIDTH = 52;
/** One rise and fall, measured from the recording. */
const SWAY_SECONDS = 12;

export function Skyline() {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(28);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setCount(Math.max(8, Math.round(el.clientWidth / BAR_WIDTH)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rnd = mulberry32(4711);
  const columns = [];
  for (let i = 0; i < count; i++) {
    // The reference never drops below about half height, and tall columns run
    // right to the top of the band.
    const lo = 0.5 + rnd() * 0.2;
    const hi = Math.min(1, lo + 0.2 + rnd() * 0.3);
    // A negative delay starts each column part-way through its own cycle.
    const phase = -(rnd() * SWAY_SECONDS).toFixed(2);
    columns.push(
      <span key={i} className="skyline-bar" style={{ '--i': i } as React.CSSProperties}>
        <span
          className="skyline-col"
          style={
            {
              '--h-lo': lo.toFixed(3),
              '--h-hi': hi.toFixed(3),
              animationDelay: `${phase}s`,
            } as React.CSSProperties
          }
        />
      </span>,
    );
  }

  return (
    <div className="skyline" ref={ref} aria-hidden="true">
      {columns}
    </div>
  );
}

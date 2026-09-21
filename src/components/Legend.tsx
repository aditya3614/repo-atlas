import { TYPE_NAMES } from '../worker/fileIndex';
import { MODE_HINTS, MODE_LABELS, type Mode, type Palette } from '../map/colors';
import type { Summary, Tables } from '../lib/protocol';

/**
 * What the colours currently mean, in words and as a scale.
 *
 * Colour is never the only channel, so this says the same thing three ways: the
 * mode's name, a sentence explaining it, and a scale whose ends are labelled
 * with real values rather than "low" and "high".
 */
export function Legend({
  mode,
  pal,
  tables,
  summary,
}: {
  mode: Mode;
  pal: Palette | null;
  tables: Tables | null;
  summary: Summary;
}) {
  if (!pal) return null;

  return (
    <div className="legend" aria-label={`What the colours mean: ${MODE_LABELS[mode]}`}>
      <div className="legend-what">
        <p className="legend-title">{MODE_LABELS[mode]}</p>
        <p className="tiny legend-hint">{MODE_HINTS[mode]}</p>
      </div>

      <div className="legend-scale">
        {mode === 'activity' && (
          <Ramp pal={pal.activity} from="Quiet for a long time" to="Changed just now" />
        )}
        {mode === 'age' && (
          <Ramp
            pal={pal.age}
            from={`Here since ${new Date(summary.firstTime).getFullYear()}`}
            to={`Added by ${new Date(summary.lastTime).getFullYear()}`}
          />
        )}
        {mode === 'type' && (
          <ul className="swatches">
            {TYPE_NAMES.map((name, i) => (
              <li key={name} className="swatch">
                <span className="swatch-dot" style={{ background: pal.type[i] }} />
                {name}
              </li>
            ))}
          </ul>
        )}
        {mode === 'author' && tables && (
          <ul className="swatches">
            {topAuthors(tables).map(([id, slot]) => (
              <li key={id} className="swatch">
                <span className="swatch-dot" style={{ background: pal.author[slot] }} />
                {tables.authorNames[id]}
                {tables.authorBot[id] === 1 && <span className="swatch-bot">bot</span>}
              </li>
            ))}
            <li className="swatch">
              <span className="swatch-dot" style={{ background: pal.author[10] }} />
              Everyone else
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}

function topAuthors(tables: Tables): [number, number][] {
  const out: [number, number][] = [];
  for (let a = 0; a < tables.authorSlot.length; a++) {
    const slot = tables.authorSlot[a]!;
    if (slot < 10) out.push([a, slot]);
  }
  return out.sort((x, y) => x[1] - y[1]);
}

function Ramp({ pal, from, to }: { pal: string[]; from: string; to: string }) {
  const stops = pal.filter((_, i) => i % 6 === 0);
  return (
    <div className="ramp">
      <div className="ramp-bar" aria-hidden="true">
        {stops.map((c, i) => (
          <span key={i} style={{ background: c }} />
        ))}
      </div>
      <div className="ramp-ends tiny">
        <span>{from}</span>
        <span>{to}</span>
      </div>
    </div>
  );
}

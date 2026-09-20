import { MODES, MODE_LABELS, type Mode } from '../map/colors';

export function ColorModes({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label="Colour the map by">
      {MODES.map((m, i) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          className={`seg-btn ${mode === m ? 'is-on' : ''}`}
          onClick={() => onChange(m)}
          title={`${MODE_LABELS[m]} — press ${i + 1}`}
        >
          {MODE_LABELS[m]}
        </button>
      ))}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { MapView } from '../components/MapView';
import { ColorModes } from '../components/ColorModes';
import { Legend } from '../components/Legend';
import { Breadcrumb } from '../components/Breadcrumb';
import { SidePanel } from '../components/SidePanel';
import { useAtlas } from '../store/atlas';
import { useMap } from '../store/map';
import { MODES } from '../map/colors';
import { readPalette } from '../map/colors';
import { formatCount } from '../lib/dom';
import { years } from '../lib/format';
import { useUi } from '../store/ui';
import type { Palette } from '../map/colors';
import '../styles/main.css';

export function Main() {
  const summary = useAtlas((s) => s.summary)!;
  const reset = useAtlas((s) => s.reset);
  const theme = useUi((s) => s.theme);
  const { mode, setMode, root, setRoot, weighting, setWeighting, tables } = useMap();
  const [pal, setPal] = useState<Palette | null>(null);

  useEffect(() => setPal(readPalette(document.documentElement)), [theme]);

  // Keyboard: 1-5 pick a colour mode, Esc clears selection then zooms out.
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const n = Number(e.key);
      if (n >= 1 && n <= MODES.length) {
        setMode(MODES[n - 1]!);
        return;
      }
      if (e.key === 'Escape') {
        const { selectedFile, root: r } = useMap.getState();
        if (selectedFile >= 0) useMap.getState().setSelectedFile(-1);
        else if (r !== '') setRoot(r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : '');
      }
    },
    [setMode, setRoot],
  );

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  return (
    <div className="main">
      <header className="top-bar">
        <div className="brand">
          <Logo />
          <span className="brand-name">Repo Atlas</span>
        </div>

        <div className="repo-line">
          <span className="repo-name">{summary.repo}</span>
          <span className="hair" aria-hidden="true" />
          <span className="mono label">{years(summary.firstTime, summary.lastTime)}</span>
          {/* Dropped first on narrow screens; the panel carries the same counts. */}
          <span className="repo-extra">
            <span className="hair" aria-hidden="true" />
            <span className="mono label">{formatCount(summary.commits)} commits</span>
            <span className="hair" aria-hidden="true" />
            <span className="mono label">{formatCount(summary.files)} files</span>
          </span>
        </div>

        <div className="top-right">
          <ColorModes mode={mode} onChange={setMode} />
          <button type="button" className="btn btn-ghost" onClick={reset}>
            Load another
          </button>
          <ThemeToggle />
        </div>
      </header>

      <div className="map-bar">
        <Breadcrumb repo={summary.repo} root={root} onNavigate={setRoot} />
        <div className="map-bar-right">
          <div className="seg seg-sm" role="radiogroup" aria-label="Cell size weighting">
            {(['balanced', 'linear'] as const).map((w) => (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={weighting === w}
                className={`seg-btn ${weighting === w ? 'is-on' : ''}`}
                onClick={() => setWeighting(w)}
                title={
                  w === 'balanced'
                    ? 'Areas use size^0.6, so small files stay visible'
                    : 'Areas are proportional to the estimated line count'
                }
              >
                {w === 'balanced' ? 'Balanced' : 'Linear'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="main-body">
        <div className="map-column">
          <MapView summary={summary} />
          <Legend mode={mode} pal={pal} tables={tables} summary={summary} />
        </div>
        <SidePanel summary={summary} />
      </main>

      <footer className="main-foot">
        <span className="tiny">
          Sizes are estimated from line counts, never from file contents. Your history never leaves
          this tab.
        </span>
        {summary.attribution && (
          <span className="tiny">
            Demo history: {summary.attribution.repo} ({summary.attribution.license})
          </span>
        )}
      </footer>
    </div>
  );
}

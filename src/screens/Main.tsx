import { useCallback, useEffect, useState } from 'react';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { MapView } from '../components/MapView';
import { ColorModes } from '../components/ColorModes';
import { Legend } from '../components/Legend';
import { Breadcrumb } from '../components/Breadcrumb';
import { SidePanel } from '../components/SidePanel';
import { Dock } from '../components/Dock';
import { atlasWorker } from '../lib/atlasClient';
import {
  clock,
  notifyClock,
  seekToCommit,
  setTimeline,
  SPEEDS,
  type Speed,
} from '../map/clock';
import type { FromWorker, TimelinePayload } from '../lib/protocol';
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
  const [timeline, setTimelineState] = useState<TimelinePayload | null>(null);
  const showArcs = useMap((s) => s.showArcs);
  const setShowArcs = useMap((s) => s.setShowArcs);

  useEffect(() => setPal(readPalette(document.documentElement)), [theme]);

  // The map opens at the latest commit, before the timeline has been built.
  useEffect(() => {
    clock.commits = summary.commits;
    clock.commit = summary.commits - 1;
  }, [summary.commits]);

  // The timeline is built once the history is loaded; until it arrives the
  // dock shows its own waiting state rather than an empty bar.
  useEffect(() => {
    const w = atlasWorker();
    const onMessage = (e: MessageEvent<FromWorker>) => {
      if (e.data.type !== 'timeline') return;
      setTimelineState(e.data.timeline);
      setTimeline(e.data.timeline, summary.commits);
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'timeline', includeBots: false });
    return () => w.removeEventListener('message', onMessage);
  }, [summary.commits]);

  const nudge = useCallback((n: number) => {
    clock.playing = false;
    seekToCommit(clock.commit + n);
    notifyClock();
  }, []);

  // Space plays, arrows step, [ and ] change speed, Home and End jump,
  // 1-5 colour the map, c toggles the connection arcs, Esc backs out.
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const n = Number(e.key);
      if (e.key !== ' ' && n >= 1 && n <= MODES.length) {
        setMode(MODES[n - 1]!);
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (!clock.playing && clock.commit >= clock.commits - 1) seekToCommit(0);
          clock.playing = !clock.playing;
          notifyClock();
          return;
        case 'ArrowLeft':
          e.preventDefault();
          nudge(e.shiftKey ? -10 : -1);
          return;
        case 'ArrowRight':
          e.preventDefault();
          nudge(e.shiftKey ? 10 : 1);
          return;
        case 'Home':
          e.preventDefault();
          nudge(-clock.commits);
          return;
        case 'End':
          e.preventDefault();
          nudge(clock.commits);
          return;
        case '[':
        case ']': {
          const i = SPEEDS.indexOf(clock.speed);
          const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + (e.key === ']' ? 1 : -1)))];
          clock.speed = next as Speed;
          notifyClock();
          return;
        }
        case 'c':
        case 'C':
          useMap.getState().setShowArcs(!useMap.getState().showArcs);
          return;
        case 'Escape': {
          const { selectedFile, root: r } = useMap.getState();
          if (selectedFile >= 0) useMap.getState().setSelectedFile(-1);
          else if (r !== '') setRoot(r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : '');
          return;
        }
      }
    },
    [nudge, setMode, setRoot],
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
          <button
            type="button"
            className={`btn btn-ghost arc-toggle ${showArcs ? 'is-on' : ''}`}
            aria-pressed={showArcs}
            onClick={() => setShowArcs(!showArcs)}
            title="Draw arcs between files that change in the same commit — c"
          >
            Connections
          </button>
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

      {pal && tables && (
        <Dock
          summary={summary}
          timeline={timeline}
          tables={tables}
          pal={pal}
          onSeek={() => undefined}
        />
      )}

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

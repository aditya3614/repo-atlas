import { useCallback, useEffect, useState } from 'react';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { MapView } from '../components/MapView';
import { ColorModes } from '../components/ColorModes';
import { Legend } from '../components/Legend';
import { Breadcrumb } from '../components/Breadcrumb';
import { SidePanel } from '../components/SidePanel';
import { Search } from '../components/Search';
import { ExportMenu } from '../components/ExportMenu';
import { HelpSheet } from '../components/HelpSheet';
import { TableView } from '../components/TableView';
import { FirstRun } from '../components/FirstRun';
import { useMeaning } from '../store/meaning';
import { AnimatePresence } from 'framer-motion';
import { Dock } from '../components/Dock';
import { atlasWorker } from '../lib/atlasClient';
import {
  clock,
  notifyClock,
  seekToCommit,
  setTimeline,
  SPEEDS,
  subscribeClock,
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
  const { mode, setMode, root, setRoot, tables } = useMap();
  const [pal, setPal] = useState<Palette | null>(null);
  const [timeline, setTimelineState] = useState<TimelinePayload | null>(null);
  const selectedFile = useMap((s) => s.selectedFile);
  const searchOpen = useMeaning((s) => s.searchOpen);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);

  useEffect(() => setPal(readPalette(document.documentElement)), [theme]);

  // The map opens at the latest commit, before the timeline has been built.
  useEffect(() => {
    clock.commits = summary.commits;
    clock.commit = summary.commits - 1;
  }, [summary.commits]);

  /*
   * Story facts, hotspots and ownership all depend on where the playhead is,
   * so they are recomputed when it settles — not while it is moving, which
   * would mean a full pass over the history on every frame.
   */
  useEffect(() => {
    const w = atlasWorker();
    const onMessage = (e: MessageEvent<FromWorker>) => {
      if (e.data.type === 'meaning') useMeaning.getState().setMeaning(e.data.meaning);
      else if (e.data.type === 'detail') useMeaning.getState().setDetail(e.data.detail);
      else if (e.data.type === 'search')
        useMeaning.getState().setHits(e.data.query, e.data.hits, e.data.people);
      else if (e.data.type === 'profile') useMeaning.getState().setProfile(e.data.profile);
      else if (e.data.type === 'authorCommits')
        useMeaning.getState().addProfileCommits(e.data.author, e.data.commits, e.data.more);
      else if (e.data.type === 'commitFiles')
        useMeaning.getState().setCommitFiles(e.data.commit, e.data.files, e.data.total);
    };
    w.addEventListener('message', onMessage);

    let pending = 0;
    const ask = () => {
      window.clearTimeout(pending);
      pending = window.setTimeout(() => {
        if (clock.playing || clock.scrubbing) return;
        w.postMessage({ type: 'meaning', commit: clock.commit });
      }, 260);
    };
    ask();
    const unsubscribe = subscribeClock(ask);
    return () => {
      window.clearTimeout(pending);
      unsubscribe();
      w.removeEventListener('message', onMessage);
    };
  }, []);

  // The selected file's detail is fetched for the commit on screen.
  useEffect(() => {
    if (selectedFile < 0) {
      useMeaning.getState().setDetail(null);
      return;
    }
    atlasWorker().postMessage({ type: 'detail', fileId: selectedFile, commit: clock.commit });
  }, [selectedFile]);

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

  // The logo goes back to the landing page, closing anything open on the way.
  const goHome = useCallback(() => {
    useMeaning.getState().setSearchOpen(false);
    useMeaning.getState().setProfile(null);
    useMap.getState().setSelectedFile(-1);
    reset();
  }, [reset]);

  const nudge = useCallback((n: number) => {
    clock.playing = false;
    seekToCommit(clock.commit + n);
    notifyClock();
  }, []);

  // Space plays, arrows step, [ and ] change speed, Home and End jump,
  // 1-4 colour the map, c toggles the connection arcs, Esc backs out.
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const n = Number(e.key);
      if (e.key !== ' ' && n >= 1 && n <= MODES.length) {
        setMode(MODES[n - 1]!);
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        useMeaning.getState().setSearchOpen(true);
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      if (e.key === 't' || e.key === 'T') {
        setTableOpen((v) => !v);
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
        case 'Escape': {
          if (helpOpen) {
            setHelpOpen(false);
            return;
          }
          if (tableOpen) {
            setTableOpen(false);
            return;
          }
          if (useMeaning.getState().searchOpen) {
            useMeaning.getState().setSearchOpen(false);
            return;
          }
          const { selectedFile, root: r } = useMap.getState();
          if (useMeaning.getState().profile) useMeaning.getState().setProfile(null);
          else if (selectedFile >= 0) useMap.getState().setSelectedFile(-1);
          else if (r !== '') setRoot(r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : '');
          return;
        }
      }
    },
    [helpOpen, nudge, setMode, setRoot, tableOpen],
  );

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  return (
    <div className="main">
      <header className="top-bar">
        <button
          type="button"
          className="brand-link"
          onClick={goHome}
          aria-label="Repo Atlas — back to the home page"
          title="Back to the home page"
        >
          <Logo />
          <span className="brand-name">Repo Atlas</span>
        </button>

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
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setTableOpen(true)}
            title="Read the same information as a table — t"
          >
            Table
          </button>
          <ExportMenu summary={summary} />
          <button
            type="button"
            className="btn btn-ghost icon-btn"
            onClick={() => setHelpOpen(true)}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts — ?"
          >
            ?
          </button>
          <button type="button" className="btn btn-ghost" onClick={reset}>
            Load another
          </button>
          <ThemeToggle />
        </div>
      </header>

      <div className="map-bar">
        <Breadcrumb repo={summary.repo} root={root} onNavigate={setRoot} />
        <div className="map-bar-right">
          <span className="colour-by label" id="colour-by-label">
            Colour by
          </span>
          <ColorModes mode={mode} onChange={setMode} />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => useMeaning.getState().setSearchOpen(true)}
            title="Find a file or a person — /"
          >
            Search <kbd className="kbd">/</kbd>
          </button>
        </div>
      </div>

      <main className="main-body">
        <div className="map-column">
          <MapView summary={summary} />
          <Legend mode={mode} pal={pal} tables={tables} summary={summary} />
        </div>
        <SidePanel summary={summary} tables={tables} />
      </main>

      <AnimatePresence>{searchOpen && <Search />}</AnimatePresence>
      <AnimatePresence>{helpOpen && <HelpSheet onClose={() => setHelpOpen(false)} />}</AnimatePresence>
      <AnimatePresence>
        {tableOpen && (
          <TableView summary={summary} tables={tables} onClose={() => setTableOpen(false)} />
        )}
      </AnimatePresence>
      <FirstRun />

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

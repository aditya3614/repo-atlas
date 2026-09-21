import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { GlobeBackdrop } from '../components/GlobeBackdrop';
import { Skyline } from '../components/Skyline';
import { CommandPanel } from '../components/CommandPanel';
import { ErrorState } from '../components/States';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { transition, usePrefersReducedMotion } from '../lib/motion';
import { useUi } from '../store/ui';
import { useAtlas } from '../store/atlas';
import { useMap } from '../store/map';
import { load } from '../lib/atlasClient';
import { DEMO } from '../lib/demo';
import '../styles/landing.css';

/** A CSS custom property the entrance animations read as their start delay. */
const delay = (ms: number): React.CSSProperties => ({ ['--d' as string]: `${ms}ms` });

export function Landing() {
  const [revealed, setRevealed] = useState(false);
  // The entrance animation belongs to the first load only; it must not replay
  // each time the intro copy swaps back in.
  const [booting, setBooting] = useState(true);
  const reduced = usePrefersReducedMotion();
  const toast = useUi((s) => s.toast);
  const atlas = useAtlas();

  const start = useCallback(
    (blob: Blob, repo: string, gzip: boolean, attribution?: typeof DEMO.attribution) => {
      const cancel = load(
        { type: 'parse', blob, repo, gzip, ...(attribution ? { attribution } : {}) },
        {
          onProgress: useAtlas.getState().setProgress,
          onDone: (summary, tables) => {
            useMap.getState().setTables(tables);
            useMap.getState().setRoot('');
            useAtlas.getState().setSummary(summary);
          },
          onError: useAtlas.getState().setError,
          onCancelled: useAtlas.getState().reset,
        },
      );
      useAtlas.getState().begin(cancel);
    },
    [],
  );

  const onInput = useCallback(
    (blob: Blob, name: string) => {
      setRevealed(true);
      start(blob, name.replace(/\.(txt|log)$/i, ''), name.endsWith('.gz'));
    },
    [start],
  );

  const onDemo = useCallback(async () => {
    try {
      const res = await fetch(DEMO.url);
      if (!res.ok) throw new Error(`${res.status}`);
      start(await res.blob(), DEMO.repo, false, DEMO.attribution);
    } catch (e) {
      console.warn('demo load failed', e);
      toast('The demo file could not be read from this page.', 'error');
    }
  }, [start, toast]);

  useEffect(() => {
    const id = window.setTimeout(() => setBooting(false), 2600);
    return () => window.clearTimeout(id);
  }, []);

  // An error from the worker opens the panel so the message is next to the fix.
  useEffect(() => {
    if (atlas.status === 'error') setRevealed(true);
  }, [atlas.status]);

  const rise = booting ? 'rise' : '';

  return (
    <div className="landing">
      <Skyline />
      <GlobeBackdrop />

      <header className="landing-top">
        <div className={`brand ${rise}`} style={delay(100)}>
          <Logo />
          <span className="brand-name">Repo Atlas</span>
        </div>
        <div className={`top-right ${rise}`} style={delay(250)}>
          <span className="chip chip-privacy">
            <span className="dot-pink" aria-hidden="true" />
            Your history never leaves this tab
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="landing-body">
        <div className="hero">
          <h1 className="display hero-title">
            <span className="line">
              <span className={`line-in ${booting ? 'is-booting' : ''}`} style={delay(200)}>
                Watch your codebase
              </span>
            </span>{' '}
            <span className="line">
              <span className={`line-in ${booting ? 'is-booting' : ''}`} style={delay(380)}>
                grow up.
              </span>
            </span>
          </h1>

          <div className={`hero-actions ${rise}`} style={delay(760)}>
            <button type="button" className="btn btn-primary" onClick={onDemo}>
              Try the demo
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              aria-expanded={revealed}
              onClick={() => setRevealed((r) => !r)}
            >
              Use your repo
            </button>
          </div>
        </div>

        <div className={`aside ${revealed ? 'is-panel' : ''}`}>
          <AnimatePresence mode="wait" initial={false}>
            {revealed ? (
              <motion.div
                key={atlas.error ? 'error' : 'steps'}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
                transition={transition(reduced)}
              >
                {atlas.error ? (
                  <ErrorState error={atlas.error} onRetry={() => useAtlas.getState().reset()} />
                ) : (
                  <CommandPanel onInput={onInput} />
                )}
              </motion.div>
            ) : (
              <motion.div
                key="intro"
                className="hero-copy"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
                transition={transition(reduced)}
              >
                <p className={`hero-sub ${rise}`} style={delay(950)}>
                  Paste one <span className="mono hero-em">git log</span> and Repo Atlas draws
                  every file as territory on a map, then plays your whole history back —{' '}
                  <span className="hero-em">who built what</span>, what keeps changing, and which
                  corners only one person understands.
                </p>
                <p className={`hero-sub ${rise}`} style={delay(1120)}>
                  Runs entirely in this tab. No uploads, no accounts, no analytics — it only ever
                  sees commit metadata, never your file contents.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <footer className={`landing-foot ${rise}`} style={delay(1300)}>
        <span className="tiny">Sizes are estimated from line counts, never from file contents.</span>
        <span className="tiny foot-right">
          Demo history: {DEMO.attribution.repo} — {DEMO.attribution.license} licensed.
        </span>
      </footer>
    </div>
  );
}

import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AmbientMap } from '../components/AmbientMap';
import { CommandPanel } from '../components/CommandPanel';
import { ErrorState, type InputError } from '../components/States';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { transition, usePrefersReducedMotion } from '../lib/motion';
import { useUi } from '../store/ui';
import { sniffInput } from '../lib/sniff';
import '../styles/landing.css';

export function Landing() {
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<InputError | null>(null);
  const reduced = usePrefersReducedMotion();
  const toast = useUi((s) => s.toast);

  const onInput = useCallback(
    async (blob: Blob, name: string) => {
      setRevealed(true);
      const problem = await sniffInput(blob);
      if (problem) {
        setError(problem);
        return;
      }
      setError(null);
      // The streaming parser arrives in M1; the handoff point is already here.
      toast(`“${name}” looks like a git log. Parsing lands in the next milestone.`);
    },
    [toast],
  );

  return (
    <div className="landing">
      <AmbientMap />
      <div className="scrim" aria-hidden="true" />

      <header className="landing-top">
        <div className="brand">
          <Logo />
          <span className="brand-name">Repo Atlas</span>
        </div>
        <div className="top-right">
          <span className="chip chip-privacy">
            <span className="dot-lime" aria-hidden="true" />
            Your history never leaves this tab
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="landing-body">
        <div className="hero">
          <h1 className="display hero-title">
            Watch your codebase<br />grow up.
          </h1>
          <p className="body-lg hero-sub measure">
            Paste one <span className="mono">git log</span> and Repo Atlas draws every file as
            territory on a map, then plays your whole history back — who built what, what keeps
            changing, and which corners only one person understands.
          </p>

          <div className="hero-actions">
            <button type="button" className="btn btn-primary" onClick={() => toast('The demo dataset lands in the next milestone.')}>
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

          <p className="tiny hero-privacy">
            Runs entirely in this tab. No uploads, no accounts, no analytics — after the page
            loads, Repo Atlas makes no network requests at all. It only ever sees commit metadata
            and line counts, never your file contents.
          </p>
        </div>

        <div className="aside">
          <AnimatePresence mode="wait" initial={false}>
            {revealed && (
              <motion.div
                key={error ? 'error' : 'steps'}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
                transition={transition(reduced)}
              >
                {error ? (
                  <ErrorState error={error} onRetry={() => setError(null)} />
                ) : (
                  <CommandPanel onInput={onInput} />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <footer className="landing-foot">
        <span className="tiny">
          Sizes are estimated from line counts, never from file contents.
        </span>
        <span className="tiny foot-right">
          Demo dataset: bundled in M1, with its licence and attribution shown here.
        </span>
      </footer>
    </div>
  );
}

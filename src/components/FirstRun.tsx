import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { transition, usePrefersReducedMotion } from '../lib/motion';

const KEY = 'atlas.seenHints';

const HINTS = [
  ['Space', 'plays the history'],
  ['Folder label', 'zooms in'],
  ['?', 'lists every shortcut'],
] as const;

/** Shown once, then never again unless the browser is cleared. */
export function FirstRun() {
  const [show, setShow] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) !== '1') setShow(true);
    } catch {
      // Private browsing: showing the hints once per visit is fine.
      setShow(true);
    }
  }, []);

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* nothing to remember it with; harmless */
    }
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="hints"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={transition(reduced)}
          role="note"
        >
          <ul className="hint-list">
            {HINTS.map(([key, what]) => (
              <li key={key}>
                <span className="hint-key">{key}</span> {what}
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-ghost hint-close" onClick={dismiss}>
            Got it
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

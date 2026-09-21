import { motion } from 'framer-motion';
import { transition, usePrefersReducedMotion } from '../lib/motion';

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Time',
    keys: [
      ['Space', 'Play or pause'],
      ['← →', 'Step one commit'],
      ['Shift + ← →', 'Jump ten commits'],
      ['Home / End', 'First or last commit'],
      ['[ ]', 'Slower or faster'],
    ],
  },
  {
    title: 'The map',
    keys: [
      ['1 – 4', 'Colour by activity, author, age or type'],
      ['c', 'Show files that change together'],
      ['Click a folder label', 'Zoom into that folder'],
      ['Esc', 'Clear the selection, then zoom out'],
    ],
  },
  {
    title: 'Finding things',
    keys: [
      ['/', 'Search for a file by path, or a person by name or email'],
      ['t', 'Read the same information as a table'],
      ['?', 'This help'],
    ],
  },
];

export function HelpSheet({ onClose }: { onClose: () => void }) {
  const reduced = usePrefersReducedMotion();

  return (
    <motion.div
      className="sheet-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={transition(reduced)}
      onClick={onClose}
    >
      <motion.div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
        transition={transition(reduced)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <h2 className="h2 sheet-title">Keyboard shortcuts</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="sheet-grid">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="panel-h">{g.title}</h3>
              <dl className="keys">
                {g.keys.map(([k, what]) => (
                  <div key={k}>
                    <dt>
                      <kbd className="kbd">{k}</kbd>
                    </dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <p className="tiny sheet-foot">
          Every control is also reachable with Tab. Your history never leaves this tab.
        </p>
      </motion.div>
    </motion.div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { atlasWorker } from '../lib/atlasClient';
import { clock, subscribeClock } from '../map/clock';
import { transition, usePrefersReducedMotion } from '../lib/motion';
import type { FromWorker, Tables } from '../lib/protocol';
import type { Palette } from '../map/colors';

/**
 * The last three commit subjects, over the corner of the map.
 *
 * Subjects live in the worker, so a window of them is fetched as playback
 * moves. At 4x the commit index can jump hundreds of times a second, so the
 * ticker samples at most eight a second — past that it is a blur anyway.
 */

const MAX_PER_SECOND = 8;
const WINDOW = 128;
const MAX_SUBJECT = 60;

interface Entry {
  commit: number;
  subject: string;
  author: number;
}

export function Ticker({ tables, pal }: { tables: Tables; pal: Palette }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const cache = useRef(new Map<number, { subject: string; author: number }>());
  const lastShown = useRef(0);
  const requested = useRef(-1);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const w = atlasWorker();
    const onMessage = (e: MessageEvent<FromWorker>) => {
      if (e.data.type !== 'subjects') return;
      const win = e.data.window;
      for (let i = 0; i < win.subjects.length; i++) {
        cache.current.set(win.from + i, {
          subject: win.subjects[i]!,
          author: win.authors[i]!,
        });
      }
      // The cache only has to cover what is on screen right now.
      if (cache.current.size > WINDOW * 6) {
        const keep = clock.commit;
        for (const k of cache.current.keys()) {
          if (Math.abs(k - keep) > WINDOW * 3) cache.current.delete(k);
        }
      }
    };
    w.addEventListener('message', onMessage);
    return () => w.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeClock(() => {
      const k = clock.commit;
      const now = performance.now();

      const block = Math.floor(k / WINDOW) * WINDOW;
      if (block !== requested.current) {
        requested.current = block;
        atlasWorker().postMessage({ type: 'subjects', from: block, count: WINDOW });
      }

      if (now - lastShown.current < 1000 / MAX_PER_SECOND) return;
      const hit = cache.current.get(k);
      if (!hit) return;
      lastShown.current = now;
      setEntries((prev) => {
        if (prev[0]?.commit === k) return prev;
        return [{ commit: k, subject: hit.subject, author: hit.author }, ...prev].slice(0, 3);
      });
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!clock.playing) return;
    return () => setEntries([]);
  }, []);

  if (entries.length === 0) return null;

  return (
    <div className="ticker" aria-hidden="true">
      <AnimatePresence initial={false}>
        {entries.map((e, i) => (
          <motion.div
            key={e.commit}
            className="ticker-row"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: i === 0 ? 1 : 0.45 - i * 0.12 }}
            exit={{ opacity: 0 }}
            transition={transition(reduced)}
          >
            <span
              className="ticker-dot"
              style={{ background: pal.author[tables.authorSlot[e.author] ?? 10] }}
            />
            <span className="ticker-who">{tables.authorNames[e.author] ?? 'unknown'}</span>
            <span className="ticker-what">
              {e.subject.length > MAX_SUBJECT ? `${e.subject.slice(0, MAX_SUBJECT)}…` : e.subject}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

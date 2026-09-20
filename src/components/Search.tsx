import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { atlasWorker } from '../lib/atlasClient';
import { clock } from '../map/clock';
import { useMeaning } from '../store/meaning';
import { useMap } from '../store/map';
import { transition, usePrefersReducedMotion } from '../lib/motion';

/**
 * Fuzzy path search. Matching runs in the worker against the files alive at
 * the current commit; non-matching cells are dimmed rather than hidden, so the
 * shape of the map stays recognisable.
 */
export function Search() {
  const { query, hits, setQuery, setSearchOpen } = useMeaning();
  const inputRef = useRef<HTMLInputElement>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (query.trim() === '') return;
    const id = window.setTimeout(() => {
      atlasWorker().postMessage({ type: 'search', query, commit: clock.commit, limit: 40 });
    }, 60);
    return () => window.clearTimeout(id);
  }, [query]);

  return (
    <motion.div
      className="search"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
      transition={transition(reduced)}
      role="dialog"
      aria-label="Find a file"
    >
      <input
        ref={inputRef}
        className="search-input mono"
        value={query}
        placeholder="Find a file…"
        aria-label="Find a file by path"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setSearchOpen(false);
          }
          if (e.key === 'Enter' && hits[0]) {
            useMap.getState().setSelectedFile(hits[0].fileId);
            setSearchOpen(false);
          }
        }}
      />
      <div className="search-meta tiny">
        {query.trim() === ''
          ? 'Type part of a path. Esc closes.'
          : `${hits.length === 40 ? '40+' : hits.length} match${hits.length === 1 ? '' : 'es'}`}
      </div>
      {hits.length > 0 && (
        <ul className="search-hits">
          {hits.slice(0, 8).map((h) => (
            <li key={h.fileId}>
              <button
                type="button"
                className="search-hit mono"
                onClick={() => {
                  useMap.getState().setSelectedFile(h.fileId);
                  setSearchOpen(false);
                }}
              >
                {h.path}
              </button>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}

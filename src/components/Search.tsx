import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { atlasWorker } from '../lib/atlasClient';
import { clock } from '../map/clock';
import { useMeaning } from '../store/meaning';
import { useMap } from '../store/map';
import { transition, usePrefersReducedMotion } from '../lib/motion';
import { formatCount } from '../lib/dom';

/**
 * Search for a file or a person. Files are matched fuzzily by path in the
 * worker against the files alive at the current commit, and non-matching cells
 * are dimmed rather than hidden, so the shape of the map stays recognisable.
 * People are matched by name or email, and choosing one opens their profile.
 */

type Row =
  | { kind: 'person'; id: number; name: string; email: string; commits: number; bot: boolean }
  | { kind: 'file'; fileId: number; path: string };

const FILE_ROWS = 8;

export function openPerson(id: number): void {
  atlasWorker().postMessage({ type: 'profile', author: id });
  useMeaning.getState().setSearchOpen(false);
}

export function Search() {
  const { query, hits, people, setQuery, setSearchOpen } = useMeaning();
  const inputRef = useRef<HTMLInputElement>(null);
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState(0);

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

  // People first, then files: one list, so the arrow keys walk through both.
  const rows = useMemo<Row[]>(
    () => [
      ...people.map((p): Row => ({ kind: 'person', ...p })),
      ...hits.slice(0, FILE_ROWS).map((h): Row => ({ kind: 'file', ...h })),
    ],
    [people, hits],
  );

  // A new result set starts at the top again.
  useEffect(() => setActive(0), [query]);

  const choose = (row: Row) => {
    if (row.kind === 'person') {
      openPerson(row.id);
      return;
    }
    useMap.getState().setSelectedFile(row.fileId);
    setSearchOpen(false);
  };

  const fileRows = rows.filter((r): r is Extract<Row, { kind: 'file' }> => r.kind === 'file');
  const personRows = rows.filter((r): r is Extract<Row, { kind: 'person' }> => r.kind === 'person');

  return (
    <motion.div
      className="search"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
      transition={transition(reduced)}
      role="dialog"
      aria-label="Find a file or a person"
    >
      <input
        ref={inputRef}
        className="search-input"
        value={query}
        placeholder="Find a file or a person…"
        aria-label="Search files by path, or people by name or email"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setSearchOpen(false);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(rows.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && rows[active]) {
            choose(rows[active]!);
          }
        }}
      />
      <div className="search-meta tiny">
        {query.trim() === ''
          ? 'Type part of a path, or a person’s name or email. Esc closes.'
          : `${personRows.length} ${personRows.length === 1 ? 'person' : 'people'} · ${
              hits.length === 40 ? '40+' : hits.length
            } file${hits.length === 1 ? '' : 's'}`}
      </div>

      {personRows.length > 0 && (
        <>
          <h3 className="search-h">People</h3>
          <ul className="search-people">
            {personRows.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`search-person ${active === i ? 'is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(p)}
                >
                  <span className="person-avatar" aria-hidden="true">
                    {p.name.trim().charAt(0).toUpperCase() || '?'}
                  </span>
                  <span className="person-who">
                    <span className="person-name">
                      {p.name}
                      {p.bot && <span className="swatch-bot">bot</span>}
                    </span>
                    <span className="person-email mono tiny">{p.email}</span>
                  </span>
                  <span className="person-n mono tiny">{formatCount(p.commits)} commit{p.commits === 1 ? '' : 's'}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {fileRows.length > 0 && (
        <>
          {personRows.length > 0 && <h3 className="search-h">Files</h3>}
          <ul className="search-hits">
            {fileRows.map((h, i) => (
              <li key={h.fileId}>
                <button
                  type="button"
                  className={`search-hit mono ${active === personRows.length + i ? 'is-active' : ''}`}
                  onMouseEnter={() => setActive(personRows.length + i)}
                  onClick={() => choose(h)}
                >
                  {h.path}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </motion.div>
  );
}

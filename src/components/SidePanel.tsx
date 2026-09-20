import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMap } from '../store/map';
import { atlasWorker } from '../lib/atlasClient';
import { compact, duration, formatCount, formatDate, megabytes } from '../lib/panelFormat';
import { transition, usePrefersReducedMotion } from '../lib/motion';
import { Sparkline } from './Sparkline';
import { TYPE_NAMES } from '../worker/fileIndex';
import type { FromWorker, Summary } from '../lib/protocol';

type Tab = 'about' | 'selection';

/**
 * The right panel. In this milestone it carries what the model already knows
 * plus the selected file; Story and Hotspots take their own tabs in M4.
 */
export function SidePanel({ summary }: { summary: Summary }) {
  const selected = useMap((s) => s.selectedFile);
  const layout = useMap((s) => s.layout);
  const tables = useMap((s) => s.tables);
  const [tab, setTab] = useState<Tab>('about');
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (selected >= 0) setTab('selection');
  }, [selected]);

  const cell = layout ? indexOfFile(layout.fileIds, selected) : -1;

  return (
    <aside className="panel-col" aria-label="Details">
      <div className="tabs" role="tablist">
        <button
          role="tab"
          type="button"
          aria-selected={tab === 'about'}
          className={`tab ${tab === 'about' ? 'is-on' : ''}`}
          onClick={() => setTab('about')}
        >
          This history
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={tab === 'selection'}
          className={`tab ${tab === 'selection' ? 'is-on' : ''}`}
          onClick={() => setTab('selection')}
          disabled={cell < 0}
        >
          Selection
        </button>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          className="panel-body"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={transition(reduced)}
        >
          {tab === 'about' ? (
            <About summary={summary} />
          ) : cell >= 0 && layout && tables ? (
            <Selection
              path={tables.paths[layout.pathIds[cell]!]!}
              size={layout.size[cell]!}
              commits={layout.commits[cell]!}
              firstTime={layout.firstTime[cell]!}
              lastTouch={layout.lastTouch[cell]!}
              author={tables.authorNames[layout.author[cell]!] ?? 'unknown'}
              type={TYPE_NAMES[layout.type[cell]!] ?? 'Code'}
              fileId={layout.fileIds[cell]!}
            />
          ) : (
            <p className="label">Click a cell on the map to see what it is.</p>
          )}
        </motion.div>
      </AnimatePresence>
    </aside>
  );
}

function About({ summary }: { summary: Summary }) {
  const human = summary.commits - summary.botCommits;
  const top = summary.topAuthors[0]?.commits ?? 1;

  return (
    <>
      <p className="label panel-lead">
        {formatDate(summary.firstTime)} to {formatDate(summary.lastTime)}. Parsed here in{' '}
        {duration(summary.parseMs)} and indexed with {formatCount(summary.checkpoints)} checkpoints,
        so scrubbing never replays from the start.
      </p>

      <dl className="mini-stats">
        <div>
          <dt className="tiny">Commits</dt>
          <dd className="mono">{formatCount(summary.commits)}</dd>
        </div>
        <div>
          <dt className="tiny">Files ever</dt>
          <dd className="mono">{formatCount(summary.files)}</dd>
        </div>
        <div>
          <dt className="tiny">People</dt>
          <dd className="mono">{formatCount(summary.authors)}</dd>
        </div>
        <div>
          <dt className="tiny">Indexed</dt>
          <dd className="mono">{megabytes(summary.indexBytes)}</dd>
        </div>
      </dl>

      <h3 className="panel-h">Who wrote it</h3>
      <p className="tiny panel-note">Top by commits, bots excluded ({formatCount(human)} human).</p>
      <ul className="authors">
        {summary.topAuthors.slice(0, 6).map((a) => (
          <li key={a.email} className="author">
            <span className="author-name">{a.name}</span>
            <span className="author-bar" aria-hidden="true">
              <span style={{ transform: `scaleX(${a.commits / top})` }} />
            </span>
            <span className="mono author-n">{formatCount(a.commits)}</span>
          </li>
        ))}
      </ul>

      <h3 className="panel-h">Biggest single commit</h3>
      <p className="panel-fact">
        “{summary.biggestCommit.subject.slice(0, 70)}” — about{' '}
        {compact(summary.biggestCommit.lines)} lines on {formatDate(summary.biggestCommit.time)}
      </p>
    </>
  );
}

function Selection(props: {
  path: string;
  size: number;
  commits: number;
  firstTime: number;
  lastTouch: number;
  author: string;
  type: string;
  fileId: number;
}) {
  const [spark, setSpark] = useState<Float32Array | null>(null);

  useEffect(() => {
    setSpark(null);
    const w = atlasWorker();
    const onMessage = (e: MessageEvent<FromWorker>) => {
      if (e.data.type === 'sparkline' && e.data.sparkline.fileId === props.fileId) {
        setSpark(e.data.sparkline.values);
      }
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'sparkline', fileId: props.fileId, samples: 80 });
    return () => w.removeEventListener('message', onMessage);
  }, [props.fileId]);

  const dir = props.path.includes('/') ? props.path.slice(0, props.path.lastIndexOf('/')) : '';
  const name = props.path.slice(props.path.lastIndexOf('/') + 1);
  const segs = dir === '' ? [] : dir.split('/');

  return (
    <>
      {/* Also the keyboard route into a folder: the label strip on the canvas
          cannot be tabbed to. */}
      <p className="sel-dir mono tiny">
        {segs.length === 0 ? (
          '(repository root)'
        ) : (
          segs.map((seg, i) => (
            <span key={i}>
              {i > 0 && <span className="crumb-sep"> / </span>}
              <button
                type="button"
                className="sel-crumb"
                title={`Zoom the map into ${segs.slice(0, i + 1).join('/')}`}
                onClick={() => useMap.getState().setRoot(segs.slice(0, i + 1).join('/'))}
              >
                {seg}
              </button>
            </span>
          ))
        )}
      </p>
      <h3 className="sel-name mono">{name}</h3>
      <span className="chip sel-chip">{props.type}</span>

      <dl className="mini-stats sel-stats">
        <div>
          <dt className="tiny">Estimated size</dt>
          <dd className="mono">~{compact(props.size)} lines</dd>
        </div>
        <div>
          <dt className="tiny">Commits</dt>
          <dd className="mono">{formatCount(props.commits)}</dd>
        </div>
        <div>
          <dt className="tiny">First seen</dt>
          <dd className="mono">{formatDate(props.firstTime)}</dd>
        </div>
        <div>
          <dt className="tiny">Last touched</dt>
          <dd className="mono">{formatDate(props.lastTouch)}</dd>
        </div>
      </dl>

      <h3 className="panel-h">Size over its life</h3>
      <Sparkline values={spark} width={312} height={64} />
      <p className="tiny panel-note">Estimated from line counts, not measured.</p>

      <h3 className="panel-h">Mostly written by</h3>
      <p className="panel-fact">{props.author}</p>
      <p className="tiny panel-note">
        The author who added the most lines. Full ownership and the bus factor arrive with the
        Story and Hotspots tabs.
      </p>
    </>
  );
}

function indexOfFile(fileIds: Uint32Array, fileId: number): number {
  if (fileId < 0) return -1;
  for (let i = 0; i < fileIds.length; i++) if (fileIds[i] === fileId) return i;
  return -1;
}

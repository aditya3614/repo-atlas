import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMap } from '../store/map';
import { useMeaning } from '../store/meaning';
import { compact, formatCount, formatDate } from '../lib/panelFormat';
import { usePrefersReducedMotion } from '../lib/motion';
import { Sparkline } from './Sparkline';
import { TYPE_NAMES } from '../worker/fileIndex';
import { clock, notifyClock, seekToCommit } from '../map/clock';
import type { FileDetail, Summary, Tables } from '../lib/protocol';

type Tab = 'story' | 'hotspots' | 'selection' | 'about';

const TABS: { id: Tab; label: string }[] = [
  { id: 'story', label: 'Story' },
  { id: 'hotspots', label: 'Hotspots' },
  { id: 'selection', label: 'Selection' },
  { id: 'about', label: 'History' },
];

export function SidePanel({ summary, tables }: { summary: Summary; tables: Tables | null }) {
  const selected = useMap((s) => s.selectedFile);
  const detail = useMeaning((s) => s.detail);
  const [tab, setTab] = useState<Tab>('story');
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (selected >= 0) setTab('selection');
  }, [selected]);

  return (
    <aside className="panel-col" aria-label="Details">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            className={`tab ${tab === t.id ? 'is-on' : ''}`}
            onClick={() => setTab(t.id)}
            disabled={t.id === 'selection' && selected < 0}
          >
            {t.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          className="panel-body"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
          // A tab is chrome, not a scene change: the old one leaves at once so
          // there is never a blank panel between the two.
          exit={{ opacity: 0, transition: { duration: 0.06 } }}
          transition={{ duration: reduced ? 0.05 : 0.16, ease: [0.22, 1, 0.36, 1] }}
        >
          {tab === 'story' && <Story />}
          {tab === 'hotspots' && <Hotspots />}
          {tab === 'selection' &&
            (detail && detail.fileId === selected ? (
              <Selection detail={detail} />
            ) : (
              <p className="label">Click a cell on the map to see what it is.</p>
            ))}
          {tab === 'about' && <About summary={summary} tables={tables} />}
        </motion.div>
      </AnimatePresence>
    </aside>
  );
}

/** Jump the playhead, and focus the map on a path when the fact names one. */
function jump(commit: number, focusPath?: string): void {
  clock.playing = false;
  seekToCommit(commit);
  notifyClock();
  if (focusPath) {
    const folder = focusPath.includes('.') ? focusPath.slice(0, focusPath.lastIndexOf('/')) : focusPath;
    if (folder) useMap.getState().setRoot(folder);
  }
}

function Story() {
  const meaning = useMeaning((s) => s.meaning);
  if (!meaning) return <p className="label">Reading the history…</p>;

  return (
    <>
      <p className="tiny panel-note panel-lead">
        Facts drawn from the commit metadata. Click one to jump to the moment it happened.
      </p>
      <ul className="facts-list">
        {meaning.facts.map((f) => (
          <li key={f.id}>
            <button type="button" className="fact-card" onClick={() => jump(f.jumpTo, f.focusPath)}>
              <span className="fact-kind tiny">{f.kind}</span>
              <span className="fact-text">{f.text}</span>
              <span className="fact-go tiny">Jump to commit {formatCount(f.jumpTo + 1)} →</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Hotspots() {
  const meaning = useMeaning((s) => s.meaning);
  if (!meaning) return <p className="label">Reading the history…</p>;

  const max = meaning.hotspots[0]?.lines ?? 1;
  const months = Math.max(1, Math.round(meaning.windowDays / 30));

  return (
    <>
      <p className="tiny panel-note panel-lead">
        Churn in the last {months} month{months === 1 ? '' : 's'}, weighted by how many people
        touched it. Lines are estimates.
      </p>

      {meaning.hotspots.length === 0 ? (
        <p className="label">Nothing has changed in this window.</p>
      ) : (
        <ol className="spots">
          {meaning.hotspots.map((h, i) => (
            <li key={h.fileId}>
              <button
                type="button"
                className="spot"
                onClick={() => useMap.getState().setSelectedFile(h.fileId)}
              >
                <span className="spot-rank mono tiny">{i + 1}</span>
                <span className="spot-main">
                  <span className="spot-path mono">{h.path}</span>
                  <span className="spot-why tiny">{h.reason}</span>
                  <span className="spot-bar" aria-hidden="true">
                    <span style={{ transform: `scaleX(${Math.max(0.02, h.lines / max)})` }} />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}

      <h3 className="panel-h">Single-owner folders</h3>
      <p className="tiny panel-note">
        One person wrote 80% of the lines. Bots are not counted.
      </p>
      {meaning.singleOwner.length === 0 ? (
        <p className="label panel-fact">Every folder here has more than one author.</p>
      ) : (
        <ul className="owners">
          {meaning.singleOwner.map((o) => (
            <li key={o.path}>
              <button
                type="button"
                className="owner"
                onClick={() => useMap.getState().setRoot(o.path)}
              >
                <span className="mono owner-path">{o.path}</span>
                <span className="tiny owner-meta">
                  {o.files} file{o.files === 1 ? '' : 's'} · ~{compact(o.lines)} lines
                </span>
                <span className="chip chip-solo">bus factor 1</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Selection({ detail }: { detail: FileDetail }) {
  const segs = detail.folder === '' ? [] : detail.folder.split('/');
  const name = detail.path.slice(detail.path.lastIndexOf('/') + 1);
  const topAdds = detail.authors[0]?.adds ?? 1;
  const playhead =
    detail.history.length > 1
      ? Math.min(1, Math.max(0, clock.commit / Math.max(1, clock.commits - 1)))
      : undefined;

  return (
    <>
      <p className="sel-dir mono tiny">
        {segs.length === 0
          ? '(repository root)'
          : segs.map((seg, i) => (
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
            ))}
      </p>
      <h3 className="sel-name mono">{name}</h3>
      <div className="sel-chips">
        <span className="chip">{TYPE_NAMES[detail.type] ?? 'Code'}</span>
        {detail.busFactor === 1 && <span className="chip chip-solo">single owner</span>}
      </div>

      <dl className="mini-stats sel-stats">
        <div>
          <dt className="tiny">Estimated size</dt>
          <dd className="mono">~{compact(detail.size)} lines</dd>
        </div>
        <div>
          <dt className="tiny">Commits</dt>
          <dd className="mono">{formatCount(detail.commits)}</dd>
        </div>
        <div>
          <dt className="tiny">Created</dt>
          <dd className="mono">{formatDate(detail.firstTime)}</dd>
        </div>
        <div>
          <dt className="tiny">Last touched</dt>
          <dd className="mono">{formatDate(detail.lastTouch)}</dd>
        </div>
      </dl>
      <p className="tiny panel-note">Created by {detail.createdBy}.</p>

      <h3 className="panel-h">Size over its life</h3>
      <Sparkline
        values={detail.history}
        width={312}
        height={64}
        {...(playhead === undefined ? {} : { playhead })}
      />
      <p className="tiny panel-note">
        Estimated from line counts, not measured. The marker is where the playhead is.
      </p>

      <h3 className="panel-h">Who wrote it</h3>
      <ul className="authors">
        {detail.authors.map((a) => (
          <li key={a.email} className="author">
            <span className="author-name">
              {a.name}
              {a.bot && <span className="swatch-bot">bot</span>}
            </span>
            <span className="author-bar" aria-hidden="true">
              <span style={{ transform: `scaleX(${Math.max(0.02, a.adds / topAdds)})` }} />
            </span>
            <span className="mono author-n">~{compact(a.adds)}</span>
          </li>
        ))}
      </ul>

      <h3 className="panel-h">Biggest commits here</h3>
      <ul className="commits">
        {detail.biggest.map((c) => (
          <li key={c.commit}>
            <button type="button" className="commit-row" onClick={() => jump(c.commit)}>
              <span className="commit-sub">{c.subject.slice(0, 64) || '(no subject)'}</span>
              <span className="tiny commit-meta mono">
                {formatDate(c.time)} · ~{compact(c.lines)} lines
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function About({ summary, tables }: { summary: Summary; tables: Tables | null }) {
  const human = summary.commits - summary.botCommits;
  const top = summary.topAuthors[0]?.commits ?? 1;

  return (
    <>
      <p className="label panel-lead">
        {formatDate(summary.firstTime)} to {formatDate(summary.lastTime)}. Parsed and indexed in
        this tab; nothing was uploaded.
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
          <dt className="tiny">Bot commits</dt>
          <dd className="mono">{formatCount(summary.botCommits)}</dd>
        </div>
      </dl>

      <h3 className="panel-h">Who wrote it</h3>
      <p className="tiny panel-note">Top by commits, bots excluded ({formatCount(human)} human).</p>
      <ul className="authors">
        {summary.topAuthors.slice(0, 8).map((a) => (
          <li key={a.email} className="author">
            <span className="author-name">{a.name}</span>
            <span className="author-bar" aria-hidden="true">
              <span style={{ transform: `scaleX(${a.commits / top})` }} />
            </span>
            <span className="mono author-n">{formatCount(a.commits)}</span>
          </li>
        ))}
      </ul>

      {tables && (
        <>
          <h3 className="panel-h">How it was indexed</h3>
          <p className="tiny panel-note">
            {formatCount(summary.checkpoints)} checkpoints every {summary.checkpointInterval}{' '}
            commits, so moving the playhead never replays from the start. Binary files carry a
            constant weight of {tables.binaryWeight}, since numstat gives them no line counts.
          </p>
        </>
      )}
    </>
  );
}

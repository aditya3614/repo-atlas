import { useState } from 'react';
import { atlasWorker } from '../lib/atlasClient';
import { clock, notifyClock, seekToCommit } from '../map/clock';
import { compact, formatCount, formatDate, formatMonth } from '../lib/panelFormat';
import { TYPE_NAMES } from '../worker/fileIndex';
import { useMap } from '../store/map';
import { useMeaning } from '../store/meaning';
import type { AuthorProfile, Tables } from '../lib/protocol';
import '../styles/person.css';

/**
 * One person, read out of the whole history: how much they did, when, where,
 * and every commit they made with the files each one touched. Everything here
 * comes from commit metadata; nothing is measured from file contents.
 */

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TYPE_VARS = ['--type-code', '--type-tests', '--type-docs', '--type-config', '--type-assets'];

function seek(commit: number): void {
  clock.playing = false;
  seekToCommit(commit);
  notifyClock();
}

function pct(share: number): string {
  const p = share * 100;
  if (p > 0 && p < 1) return '<1%';
  return `${p >= 10 ? Math.round(p) : p.toFixed(1)}%`;
}

/** "3 years, 2 months" — a span in words rather than a day count. */
function spanLabel(days: number): string {
  if (days <= 0) return 'no time at all';
  if (days < 2) return '1 day';
  if (days < 60) return `${days} days`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months} months`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return `${years} year${years === 1 ? '' : 's'}${rest ? `, ${rest} month${rest === 1 ? '' : 's'}` : ''}`;
}

export function PersonPanel({ profile: p, tables }: { profile: AuthorProfile; tables: Tables | null }) {
  const slot = tables ? tables.authorSlot[p.id] ?? 10 : 10;
  const colour = slot >= 10 ? 'var(--cat-rest)' : `var(--cat-${slot + 1})`;
  const perDay = p.activeDays > 0 ? p.commits / p.activeDays : 0;

  return (
    <div className="person">
      <div className="person-head">
        <span className="person-avatar person-avatar-lg" style={{ borderColor: colour, color: colour }}>
          {p.name.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <div className="person-id">
          <h3 className="person-title">
            {p.name}
            {p.bot && <span className="swatch-bot">bot</span>}
          </h3>
          <p className="mono tiny person-mail">{p.email}</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost person-close"
          onClick={() => useMeaning.getState().setProfile(null)}
          aria-label="Close this profile"
          title="Close — Esc"
        >
          Close
        </button>
      </div>
      <p className="tiny panel-note person-lead">
        Number {p.rank} of {formatCount(p.people)} by commits. Their files are lit on the map; every
        other file is dimmed.
      </p>

      <dl className="mini-stats">
        <Stat label="Commits" value={formatCount(p.commits)} />
        <Stat label="Lines added" value={`~${compact(p.adds)}`} />
        <Stat label="Lines removed" value={`~${compact(p.dels)}`} />
        <Stat label="Files touched" value={formatCount(p.filesTouched)} />
        <Stat label="Days with a commit" value={formatCount(p.activeDays)} />
        <Stat label="Longest streak" value={`${formatCount(p.longestStreak)} day${p.longestStreak === 1 ? '' : 's'}`} />
      </dl>

      <h3 className="panel-h">Timeline</h3>
      <dl className="rows">
        <Row
          label="First commit"
          value={formatDate(p.first.time)}
          note={p.first.subject}
          onClick={() => seek(p.first.commit)}
        />
        <Row
          label="Latest commit"
          value={formatDate(p.last.time)}
          note={p.last.subject}
          onClick={() => seek(p.last.commit)}
        />
        <Row
          label="Busiest day"
          value={formatDate(p.busiest.time)}
          note={`${formatCount(p.busiest.commits)} commit${p.busiest.commits === 1 ? '' : 's'} in one day`}
          onClick={() => seek(p.busiest.commit)}
        />
        <Row
          label="Active for"
          value={spanLabel(p.spanDays)}
          note={`${perDay.toFixed(1)} commits on each day they committed`}
        />
      </dl>

      <h3 className="panel-h">Share of the repository</h3>
      <ul className="shares">
        <Share label="Commits" share={p.commitShare} detail={`${formatCount(p.commits)} of all`} />
        <Share label="Lines added" share={p.addShare} detail={`~${compact(p.adds)}`} />
        <Share label="Lines removed" share={p.delShare} detail={`~${compact(p.dels)}`} />
        <Share
          label="Files touched"
          share={p.filesTotal > 0 ? p.filesTouched / p.filesTotal : 0}
          detail={`${formatCount(p.filesTouched)} of ${formatCount(p.filesTotal)}`}
        />
      </ul>
      <p className="tiny panel-note">
        Most of the lines in {formatCount(p.owns)} file{p.owns === 1 ? '' : 's'} are theirs.
      </p>

      <h3 className="panel-h">Activity over the project’s life</h3>
      <Activity p={p} />

      <h3 className="panel-h">Days of the week</h3>
      <Weekdays counts={p.weekdays} />

      <h3 className="panel-h">What they work on</h3>
      <Kinds kinds={p.kinds} />
      {p.topFolders.length > 0 && (
        <ul className="folders">
          {p.topFolders.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                className="folder-row"
                disabled={f.path === '(root)'}
                title={f.path === '(root)' ? undefined : `Zoom the map into ${f.path}`}
                onClick={() => useMap.getState().setRoot(f.path)}
              >
                <span className="mono">{f.path === '(root)' ? '(repository root)' : f.path}</span>
                <span className="mono tiny">{formatCount(f.touches)} changes</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="panel-h">Files they changed most</h3>
      <ol className="spots">
        {p.topFiles.map((f, i) => (
          <li key={f.fileId}>
            <button
              type="button"
              className="spot"
              title={`Last changed ${formatDate(f.last)}`}
              onClick={() => useMap.getState().setSelectedFile(f.fileId)}
            >
              <span className="spot-rank mono tiny">{i + 1}</span>
              <span className="spot-main">
                <span className="spot-path mono">{f.path}</span>
                <span className="spot-why tiny">
                  {formatCount(f.commits)} change{f.commits === 1 ? '' : 's'} ·{' '}
                  <span className="plus">+{compact(f.adds)}</span>{' '}
                  <span className="minus">−{compact(f.dels)}</span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      <h3 className="panel-h">Commits</h3>
      <p className="tiny panel-note">
        Newest first. Open one to see the files it changed, named as they were at the time.
      </p>
      <Commits p={p} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="tiny">{label}</dt>
      <dd className="mono">{value}</dd>
    </div>
  );
}

function Row({
  label,
  value,
  note,
  onClick,
}: {
  label: string;
  value: string;
  note?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="row-k tiny">{label}</span>
      <span className="row-v mono">{value}</span>
      {note && <span className="row-note tiny">{note}</span>}
    </>
  );
  return (
    <div className="row-wrap">
      {onClick ? (
        <button type="button" className="row row-btn" onClick={onClick} title="Jump the map to that moment">
          {body}
        </button>
      ) : (
        <div className="row">{body}</div>
      )}
    </div>
  );
}

function Share({ label, share, detail }: { label: string; share: number; detail: string }) {
  return (
    <li className="share">
      <span className="share-label">{label}</span>
      <span className="author-bar" aria-hidden="true">
        <span style={{ transform: `scaleX(${Math.max(0.01, Math.min(1, share))})` }} />
      </span>
      <span className="mono share-n">{pct(share)}</span>
      <span className="tiny share-detail">{detail}</span>
    </li>
  );
}

function Activity({ p }: { p: AuthorProfile }) {
  const max = Math.max(1, ...p.activity);
  const slice = (p.activityTo - p.activityFrom) / p.activity.length;
  return (
    <>
      <div className="bars" role="img" aria-label="Commits per slice of the project's life">
        {Array.from(p.activity, (n, i) => {
          const from = p.activityFrom + i * slice;
          return (
            <span
              key={i}
              className={`bar ${n > 0 ? 'has' : ''}`}
              style={{ height: `${n === 0 ? 3 : Math.max(8, (n / max) * 100)}%` }}
              title={`${formatMonth(from)}: ${formatCount(n)} commit${n === 1 ? '' : 's'}`}
            />
          );
        })}
      </div>
      <div className="bars-axis tiny mono">
        <span>{formatMonth(p.activityFrom)}</span>
        <span>{formatMonth(p.activityTo)}</span>
      </div>
    </>
  );
}

function Weekdays({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const busiest = counts.indexOf(Math.max(...counts));
  return (
    <>
      <div className="week" role="img" aria-label="Commits by day of the week">
        {counts.map((n, i) => (
          <div key={i} className="week-col" title={`${WEEKDAY_NAMES[i]}: ${formatCount(n)}`}>
            <span className="week-bar">
              <span style={{ height: `${n === 0 ? 2 : Math.max(6, (n / max) * 100)}%` }} />
            </span>
            <span className="tiny week-day">{WEEKDAYS[i]}</span>
          </div>
        ))}
      </div>
      {total > 0 && (
        <p className="tiny panel-note">
          Most often on {WEEKDAY_NAMES[busiest]}s ({pct(counts[busiest]! / total)} of their commits).
        </p>
      )}
    </>
  );
}

function Kinds({ kinds }: { kinds: number[] }) {
  const total = kinds.reduce((a, b) => a + b, 0);
  if (total === 0) return <p className="label">No file changes recorded.</p>;
  return (
    <>
      <div className="kinds" role="img" aria-label="File changes by kind">
        {kinds.map((n, i) =>
          n > 0 ? (
            <span
              key={i}
              style={{ flexGrow: n, background: `var(${TYPE_VARS[i]})` }}
              title={`${TYPE_NAMES[i]}: ${formatCount(n)}`}
            />
          ) : null,
        )}
      </div>
      <ul className="kind-legend">
        {kinds.map((n, i) =>
          n > 0 ? (
            <li key={i} className="tiny">
              <span className="swatch-dot" style={{ background: `var(${TYPE_VARS[i]})` }} />
              {TYPE_NAMES[i]} <span className="mono">{pct(n / total)}</span>
            </li>
          ) : null,
        )}
      </ul>
    </>
  );
}

function Commits({ p }: { p: AuthorProfile }) {
  const commits = useMeaning((s) => s.profileCommits);
  const more = useMeaning((s) => s.profileMore);
  const cache = useMeaning((s) => s.commitFiles);
  const [open, setOpen] = useState<number | null>(null);

  const toggle = (commit: number) => {
    if (open === commit) {
      setOpen(null);
      return;
    }
    setOpen(commit);
    if (!cache[commit]) atlasWorker().postMessage({ type: 'commitFiles', commit });
  };

  const loadMore = () => {
    const oldest = commits[commits.length - 1]?.commit ?? clock.commits;
    atlasWorker().postMessage({ type: 'authorCommits', author: p.id, before: oldest, limit: 25 });
  };

  return (
    <>
      <ul className="commit-list">
        {commits.map((c) => {
          const isOpen = open === c.commit;
          const files = cache[c.commit];
          return (
            <li key={c.commit} className={`commit-item ${isOpen ? 'is-open' : ''}`}>
              <button
                type="button"
                className="commit-head"
                aria-expanded={isOpen}
                onClick={() => toggle(c.commit)}
              >
                <span className="commit-sub">{c.subject.slice(0, 80) || '(no subject)'}</span>
                <span className="tiny commit-meta mono">
                  {formatDate(c.time)} · {formatCount(c.files)} file{c.files === 1 ? '' : 's'} ·{' '}
                  <span className="plus">+{compact(c.adds)}</span>{' '}
                  <span className="minus">−{compact(c.dels)}</span>
                </span>
              </button>
              {isOpen && (
                <div className="commit-body">
                  {!files ? (
                    <p className="tiny panel-note">Reading the commit…</p>
                  ) : (
                    <>
                      <ul className="commit-files">
                        {files.files.map((f, i) => (
                          <li key={`${f.fileId}-${i}`}>
                            <button
                              type="button"
                              className="commit-file"
                              title="Show this file on the map, at this commit"
                              onClick={() => {
                                seek(c.commit);
                                useMap.getState().setSelectedFile(f.fileId);
                              }}
                            >
                              <span className="spot-path mono">{f.path}</span>
                              <span className="tiny mono commit-file-n">
                                {f.binary ? (
                                  'binary'
                                ) : (
                                  <>
                                    <span className="plus">+{compact(f.adds)}</span>{' '}
                                    <span className="minus">−{compact(f.dels)}</span>
                                  </>
                                )}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      {files.total > files.files.length && (
                        <p className="tiny panel-note">
                          Showing {formatCount(files.files.length)} of {formatCount(files.total)}{' '}
                          files.
                        </p>
                      )}
                    </>
                  )}
                  <button type="button" className="btn btn-ghost commit-jump" onClick={() => seek(c.commit)}>
                    Jump the map to this commit
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {more && (
        <button type="button" className="btn btn-secondary commit-more" onClick={loadMore}>
          Show older commits
        </button>
      )}
      {!more && commits.length > 0 && (
        <p className="tiny panel-note">
          That is all {formatCount(p.commits)} of {p.name.split(' ')[0]}’s commits.
        </p>
      )}
    </>
  );
}

import { motion } from 'framer-motion';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { useAtlas } from '../store/atlas';
import { formatCount } from '../lib/dom';
import { compact, duration, formatDate, megabytes, years } from '../lib/format';
import { transition, usePrefersReducedMotion } from '../lib/motion';
import '../styles/overview.css';

/**
 * M1's landing place for a parsed history: everything the model knows, before
 * the map exists to show it. M2 replaces the middle of this screen with the
 * map; the top bar is already the one the main view will keep.
 */
export function Overview() {
  const summary = useAtlas((s) => s.summary)!;
  const reset = useAtlas((s) => s.reset);
  const reduced = usePrefersReducedMotion();

  const topCommits = summary.topAuthors[0]?.commits ?? 1;
  const humanCommits = summary.commits - summary.botCommits;

  return (
    <motion.div
      className="overview"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={transition(reduced)}
    >
      <header className="top-bar">
        <div className="brand">
          <Logo />
          <span className="brand-name">Repo Atlas</span>
        </div>

        <div className="repo-line">
          <span className="repo-name">{summary.repo}</span>
          <span className="hair" aria-hidden="true" />
          <span className="mono label">{years(summary.firstTime, summary.lastTime)}</span>
          <span className="hair" aria-hidden="true" />
          <span className="mono label">{formatCount(summary.commits)} commits</span>
          <span className="hair" aria-hidden="true" />
          <span className="mono label">{formatCount(summary.files)} files</span>
        </div>

        <div className="top-right">
          <button type="button" className="btn btn-ghost" onClick={reset}>
            Load another
          </button>
          <ThemeToggle />
        </div>
      </header>

      <main className="overview-body">
        <section className="panel card">
          <h2 className="h2 panel-title">The history, read and indexed</h2>
          <p className="label panel-sub">
            {formatDate(summary.firstTime)} to {formatDate(summary.lastTime)}. Parsed in this tab in{' '}
            {duration(summary.parseMs)}, indexed with {formatCount(summary.checkpoints)}{' '}
            checkpoints every {summary.checkpointInterval} commits so scrubbing never replays from
            the start. The map arrives in the next milestone.
          </p>

          <dl className="stats">
            <div className="stat">
              <dt className="tiny">Commits</dt>
              <dd className="mono stat-v">{formatCount(summary.commits)}</dd>
              <span className="tiny stat-note">{formatCount(summary.botCommits)} from bots</span>
            </div>
            <div className="stat">
              <dt className="tiny">Files ever seen</dt>
              <dd className="mono stat-v">{formatCount(summary.files)}</dd>
              <span className="tiny stat-note">{formatCount(summary.peakAlive)} at the peak</span>
            </div>
            <div className="stat">
              <dt className="tiny">People</dt>
              <dd className="mono stat-v">{formatCount(summary.authors)}</dd>
              <span className="tiny stat-note">by email address</span>
            </div>
            <div className="stat">
              <dt className="tiny">Input</dt>
              <dd className="mono stat-v">{megabytes(summary.bytes)}</dd>
              <span className="tiny stat-note">
                {megabytes(summary.indexBytes)} indexed, never left this tab
              </span>
            </div>
          </dl>
        </section>

        <section className="panel card">
          <h3 className="h3 panel-title">Who wrote it</h3>
          <p className="label panel-sub">
            Top {summary.topAuthors.length} by commits, bots excluded ({formatCount(humanCommits)}{' '}
            human commits).
          </p>
          <ul className="authors">
            {summary.topAuthors.map((a) => (
              <li key={a.email} className="author">
                <span className="author-name">{a.name}</span>
                <span className="author-bar" aria-hidden="true">
                  <span style={{ transform: `scaleX(${a.commits / topCommits})` }} />
                </span>
                <span className="mono author-n">{formatCount(a.commits)}</span>
                <span className="mono author-lines" title="Estimated from line counts">
                  ~{compact(a.adds)} lines
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel card">
          <h3 className="h3 panel-title">Already in the index</h3>
          <ul className="facts">
            <li className="fact">
              <span className="fact-k tiny">Largest single commit</span>
              <span className="fact-v">
                “{summary.biggestCommit.subject.slice(0, 60)}” — about{' '}
                {compact(summary.biggestCommit.lines)} lines on{' '}
                {formatDate(summary.biggestCommit.time)}
              </span>
            </li>
            <li className="fact">
              <span className="fact-k tiny">Most files at once</span>
              <span className="fact-v">
                {formatCount(summary.peakAlive)} files, at commit{' '}
                {formatCount(summary.peakAliveAt + 1)}
              </span>
            </li>
            <li className="fact">
              <span className="fact-k tiny">Sizes</span>
              <span className="fact-v">
                Estimated from added and deleted line counts. Binary files have no line counts at
                all and carry a constant weight of 30.
              </span>
            </li>
          </ul>
        </section>
      </main>

      <footer className="overview-foot">
        <span className="tiny">Sizes are estimated from line counts, never from file contents.</span>
        {summary.attribution && (
          <span className="tiny">
            Demo history: {summary.attribution.repo} ({summary.attribution.license}) —{' '}
            {summary.attribution.url}
          </span>
        )}
      </footer>
    </motion.div>
  );
}

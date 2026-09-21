import { motion } from 'framer-motion';
import { useMeaning } from '../store/meaning';
import { useMap } from '../store/map';
import { compact, formatCount, formatDate } from '../lib/panelFormat';
import { usePrefersReducedMotion } from '../lib/motion';
import { clock, notifyClock, seekToCommit } from '../map/clock';
import type { Summary, Tables } from '../lib/protocol';

/**
 * The same information as the map, as real HTML tables.
 *
 * Section 11 asks for this: a canvas cannot be read by a screen reader or
 * copied into a spreadsheet, so everything the picture says is also available
 * as text, sortable by the browser's own find and selectable with the mouse.
 */
export function TableView({
  summary,
  tables,
  onClose,
}: {
  summary: Summary;
  tables: Tables | null;
  onClose: () => void;
}) {
  const meaning = useMeaning((s) => s.meaning);
  const reduced = usePrefersReducedMotion();
  const author = (id: number) => tables?.authorNames[id] ?? 'unknown';

  return (
    <motion.div
      className="table-view"
      role="dialog"
      aria-modal="true"
      aria-label="The map as a table"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      // A full-screen view should land, not drift in: while it is part-way
      // through a fade the map behind it shows through the text.
      transition={{ duration: reduced ? 0.05 : 0.14, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="table-head">
        <div>
          <h2 className="h2">{summary.repo} as a table</h2>
          <p className="tiny table-sub">
            Everything the map shows, in text. Figures are as of{' '}
            {formatDate(clock.timeline?.times[clock.commit] ?? summary.lastTime)}, commit{' '}
            {formatCount(clock.commit + 1)} of {formatCount(summary.commits)}. Line counts are
            estimates.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Back to the map
        </button>
      </header>

      <div className="table-body">
        <section>
          <h3 className="panel-h">Story</h3>
          <table className="data">
            <caption className="sr-only">
              Facts about this history, each with the commit it refers to
            </caption>
            <thead>
              <tr>
                <th scope="col">What</th>
                <th scope="col">Detail</th>
                <th scope="col">Commit</th>
              </tr>
            </thead>
            <tbody>
              {(meaning?.facts ?? []).map((f) => (
                <tr key={f.id}>
                  <th scope="row">{f.kind}</th>
                  <td>{f.text}</td>
                  <td className="mono num">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        clock.playing = false;
                        seekToCommit(f.jumpTo);
                        notifyClock();
                        onClose();
                      }}
                    >
                      {formatCount(f.jumpTo + 1)}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h3 className="panel-h">
            Hotspots — most changed in the last{' '}
            {Math.max(1, Math.round((meaning?.windowDays ?? 0) / 30))} months
          </h3>
          <table className="data">
            <caption className="sr-only">
              Files ranked by recent churn weighted by the number of people involved
            </caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">File</th>
                <th scope="col" className="num">Commits</th>
                <th scope="col" className="num">People</th>
                <th scope="col" className="num">Lines changed</th>
              </tr>
            </thead>
            <tbody>
              {(meaning?.hotspots ?? []).map((h, i) => (
                <tr key={h.fileId}>
                  <td className="mono num">{i + 1}</td>
                  <th scope="row" className="mono">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        useMap.getState().setSelectedFile(h.fileId);
                        onClose();
                      }}
                    >
                      {h.path}
                    </button>
                  </th>
                  <td className="mono num">{formatCount(h.commits)}</td>
                  <td className="mono num">{formatCount(h.authors)}</td>
                  <td className="mono num">~{compact(h.lines)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h3 className="panel-h">Folders</h3>
          <table className="data">
            <caption className="sr-only">
              Folders with their size, contributors and bus factor. A bus factor of 1 means one
              person wrote 80% of the lines.
            </caption>
            <thead>
              <tr>
                <th scope="col">Folder</th>
                <th scope="col" className="num">Files</th>
                <th scope="col" className="num">Lines added</th>
                <th scope="col" className="num">People</th>
                <th scope="col" className="num">Bus factor</th>
                <th scope="col">Mostly written by</th>
              </tr>
            </thead>
            <tbody>
              {(meaning?.folders ?? []).map((f) => (
                <tr key={f.path}>
                  <th scope="row" className="mono">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        useMap.getState().setRoot(f.path);
                        onClose();
                      }}
                    >
                      {f.path}
                    </button>
                  </th>
                  <td className="mono num">{formatCount(f.files)}</td>
                  <td className="mono num">~{compact(f.lines)}</td>
                  <td className="mono num">{formatCount(f.authors)}</td>
                  <td className="mono num">
                    {f.busFactor}
                    {f.busFactor === 1 && <span className="chip chip-solo tbl-chip">single owner</span>}
                  </td>
                  <td>
                    {author(f.topAuthor)} ({Math.round(f.topShare * 100)}%)
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h3 className="panel-h">People</h3>
          <table className="data">
            <caption className="sr-only">Contributors by number of commits, bots excluded</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col" className="num">Commits</th>
                <th scope="col" className="num">Lines added</th>
              </tr>
            </thead>
            <tbody>
              {summary.topAuthors.map((a) => (
                <tr key={a.email}>
                  <th scope="row">{a.name}</th>
                  <td className="mono num">{formatCount(a.commits)}</td>
                  <td className="mono num">~{compact(a.adds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </motion.div>
  );
}

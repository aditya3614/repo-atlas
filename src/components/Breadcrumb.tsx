/** Where the map is drilled to. Esc, or any crumb, goes back up. */
export function Breadcrumb({
  repo,
  root,
  onNavigate,
}: {
  repo: string;
  root: string;
  onNavigate: (path: string) => void;
}) {
  const segs = root === '' ? [] : root.split('/');

  return (
    <nav className="crumbs" aria-label="Map location">
      <button
        type="button"
        className="crumb"
        onClick={() => onNavigate('')}
        aria-current={root === '' ? 'page' : undefined}
        disabled={root === ''}
      >
        {repo}
      </button>
      {segs.map((seg, i) => {
        const path = segs.slice(0, i + 1).join('/');
        const last = i === segs.length - 1;
        return (
          <span key={path} className="crumb-group">
            <span className="crumb-sep" aria-hidden="true">
              /
            </span>
            <button
              type="button"
              className="crumb mono"
              onClick={() => onNavigate(path)}
              aria-current={last ? 'page' : undefined}
              disabled={last}
            >
              {seg}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

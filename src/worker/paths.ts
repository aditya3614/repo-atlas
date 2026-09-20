/**
 * Rename path reconstruction.
 *
 * git --numstat with -M writes a rename on one line, in one of five shapes.
 * All five are confirmed against real git output (see e2e fixture):
 *
 *   src/core/{engine.js => runner.js}     brace segment inside a path
 *   {src/core => lib/kernel}/runner.js    brace segment at the front
 *   pkg/{ => sub}/thing.txt               moved into a directory
 *   pkg/{sub => }/thing.txt               moved out of a directory
 *   sub/a.txt => a.txt                    no common prefix at all
 */

export interface RenamePair {
  from: string;
  to: string;
}

const ARROW = ' => ';

/** Collapse the empty segments a brace form can leave behind. */
export function normalizePath(p: string): string {
  let out = p;
  while (out.includes('//')) out = out.replace('//', '/');
  if (out.startsWith('/')) out = out.slice(1);
  return out;
}

/**
 * Returns the old and new path for a rename, or null when the line is an
 * ordinary path. Paths may contain spaces, braces and non-ASCII characters, so
 * this works by locating the brace pair, never by splitting on whitespace.
 */
export function parseRename(path: string): RenamePair | null {
  const open = path.indexOf('{');
  if (open !== -1) {
    const close = path.indexOf('}', open);
    if (close !== -1) {
      const inner = path.slice(open + 1, close);
      const arrow = inner.indexOf(ARROW);
      if (arrow !== -1) {
        const prefix = path.slice(0, open);
        const suffix = path.slice(close + 1);
        const from = inner.slice(0, arrow);
        const to = inner.slice(arrow + ARROW.length);
        return {
          from: normalizePath(prefix + from + suffix),
          to: normalizePath(prefix + to + suffix),
        };
      }
    }
  }

  // Plain form. A literal " => " inside a filename would be ambiguous here;
  // git writes the brace form whenever a common prefix exists, so the plain
  // form is only produced for genuine renames.
  const arrow = path.indexOf(ARROW);
  if (arrow !== -1) {
    return {
      from: normalizePath(path.slice(0, arrow)),
      to: normalizePath(path.slice(arrow + ARROW.length)),
    };
  }

  return null;
}

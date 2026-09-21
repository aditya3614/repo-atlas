import { hierarchy, treemap, treemapSquarify, type HierarchyRectangularNode } from 'd3-hierarchy';
import type { Dataset } from './model';
import { heatAt, type FileState } from './state';
import type { FileIndex } from './fileIndex';

/**
 * Treemap layout for the files alive at one commit.
 *
 * Sibling order is by name, never by size, so a cell does not jump across the
 * map when a file grows. Areas use size^0.6: raw line counts let one generated
 * file swallow the picture, and the exponent keeps small files legible while
 * leaving the order of sizes truthful.
 */

export interface LayoutRequest {
  commit: number;
  width: number;
  height: number;
  /** Folder to draw, '' for the whole repository. */
  root: string;
}

/** Everything the renderer needs for one frame, as transferable arrays. */
export interface LayoutResult {
  commit: number;
  root: string;
  width: number;
  height: number;
  /** Four floats per cell: x0, y0, x1, y1. */
  rects: Float32Array;
  fileIds: Uint32Array;
  pathIds: Uint32Array;
  size: Int32Array;
  heat: Float32Array;
  lastTouch: Float64Array;
  commits: Uint32Array;
  author: Uint32Array;
  type: Uint8Array;
  firstTime: Float64Array;
  /** Folder regions, deepest last, for borders and labels. */
  folderRects: Float32Array;
  folderDepth: Uint8Array;
  folderNames: string[];
  folderPaths: string[];
  /** Files alive but too small to draw, folded into their parent's fill. */
  hiddenCount: number;
  aliveCount: number;
}

interface Node {
  name: string;
  /** Leaf only. */
  file: number;
  value: number;
  children?: Map<string, Node>;
}

const LABEL_GUTTER = 15;
/** Compresses extremes without reordering them; see the note above. */
const AREA_EXPONENT = 0.6;

function makeNode(name: string): Node {
  return { name, file: -1, value: 0, children: new Map() };
}

/** Wraps the Map-based tree in the shape d3-hierarchy wants. */
function toHierarchy(n: Node): { name: string; file: number; value: number; children?: unknown[] } {
  if (!n.children) return { name: n.name, file: n.file, value: n.value };
  const kids = [...n.children.values()].map(toHierarchy);
  // Stable order by name so cells keep their place while scrubbing.
  kids.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { name: n.name, file: -1, value: 0, children: kids };
}

export function computeLayout(
  d: Dataset,
  index: FileIndex,
  state: FileState,
  req: LayoutRequest,
): LayoutResult {
  const now = d.time[req.commit] ?? d.time[d.commitCount - 1] ?? 0;
  const tau = d.tau;
  const prefix = req.root === '' ? '' : `${req.root}/`;

  const root = makeNode('');
  let aliveCount = 0;

  for (let f = 0; f < d.fileCount; f++) {
    if (state.alive[f] === 0) continue;
    aliveCount++;
    const path = d.paths[state.pathIndex[f]!]!;
    if (prefix !== '' && !path.startsWith(prefix)) continue;
    const rest = prefix === '' ? path : path.slice(prefix.length);

    let node = root;
    let start = 0;
    for (;;) {
      const slash = rest.indexOf('/', start);
      if (slash === -1) break;
      const seg = rest.slice(start, slash);
      let next = node.children!.get(seg);
      if (next === undefined) {
        next = makeNode(seg);
        node.children!.set(seg, next);
      }
      node = next;
      start = slash + 1;
    }
    const leafName = rest.slice(start);
    // A weight of zero would make the cell vanish; an empty file still exists.
    const size = Math.max(1, state.size[f]!);
    const leaf: Node = { name: leafName, file: f, value: Math.pow(size, AREA_EXPONENT) };
    node.children!.set(leafName, leaf);
  }

  const h = hierarchy(toHierarchy(root) as { name: string; file: number; value: number })
    // No .sort(): toHierarchy already fixed sibling order by name, and sorting
    // by value is exactly what makes cells jump around during playback.
    .sum((n) => (n as { value: number }).value);

  treemap<{ name: string; file: number; value: number }>()
    .tile(treemapSquarify)
    .size([req.width, req.height])
    .paddingInner(1)
    .paddingOuter(2)
    // A folder only gets a label gutter when there is room for the label.
    .paddingTop((n) => {
      const r = n as unknown as HierarchyRectangularNode<unknown>;
      return r.x1 - r.x0 > 64 && r.y1 - r.y0 > 44 ? LABEL_GUTTER : 2;
    })
    .round(true)(h as HierarchyRectangularNode<{ name: string; file: number; value: number }>);

  const leaves: HierarchyRectangularNode<{ name: string; file: number; value: number }>[] = [];
  const folders: HierarchyRectangularNode<{ name: string; file: number; value: number }>[] = [];
  (h as HierarchyRectangularNode<{ name: string; file: number; value: number }>).each((n) => {
    if (n.data.file >= 0) leaves.push(n);
    else if (n.depth > 0) folders.push(n);
  });

  const n = leaves.length;
  const rects = new Float32Array(n * 4);
  const fileIds = new Uint32Array(n);
  const pathIds = new Uint32Array(n);
  const size = new Int32Array(n);
  const heat = new Float32Array(n);
  const lastTouch = new Float64Array(n);
  const commits = new Uint32Array(n);
  const author = new Uint32Array(n);
  const type = new Uint8Array(n);
  const firstTime = new Float64Array(n);

  let hiddenCount = 0;
  for (let i = 0; i < n; i++) {
    const node = leaves[i]!;
    const f = node.data.file;
    rects[i * 4] = node.x0;
    rects[i * 4 + 1] = node.y0;
    rects[i * 4 + 2] = node.x1;
    rects[i * 4 + 3] = node.y1;
    fileIds[i] = f;
    const p = state.pathIndex[f]!;
    pathIds[i] = p;
    size[i] = state.size[f]!;
    heat[i] = heatAt(state, f, now, tau);
    lastTouch[i] = state.lastTouch[f]!;
    commits[i] = d.files.commitCount[f]!;
    author[i] = index.dominantAuthor[f]!;
    type[i] = index.pathType[p]!;
    firstTime[i] = d.time[d.files.firstCommit[f]!] ?? 0;
    if (node.x1 - node.x0 < 0.75 || node.y1 - node.y0 < 0.75) hiddenCount++;
  }

  const fCount = folders.length;
  const folderRects = new Float32Array(fCount * 4);
  const folderDepth = new Uint8Array(fCount);
  const folderNames: string[] = [];
  const folderPaths: string[] = [];
  for (let i = 0; i < fCount; i++) {
    const node = folders[i]!;
    folderRects[i * 4] = node.x0;
    folderRects[i * 4 + 1] = node.y0;
    folderRects[i * 4 + 2] = node.x1;
    folderRects[i * 4 + 3] = node.y1;
    folderDepth[i] = Math.min(255, node.depth);
    folderNames.push(node.data.name);
    const segs: string[] = [];
    for (let p: typeof node | null = node; p && p.depth > 0; p = p.parent) segs.unshift(p.data.name);
    folderPaths.push(prefix + segs.join('/'));
  }

  return {
    commit: req.commit,
    root: req.root,
    width: req.width,
    height: req.height,
    rects,
    fileIds,
    pathIds,
    size,
    heat,
    lastTouch,
    commits,
    author,
    type,
    firstTime,
    folderRects,
    folderDepth,
    folderNames,
    folderPaths,
    hiddenCount,
    aliveCount,
  };
}

/** The buffers that move to the main thread, for postMessage's transfer list. */
export function transferables(r: LayoutResult): Transferable[] {
  return [
    r.rects.buffer,
    r.fileIds.buffer,
    r.pathIds.buffer,
    r.size.buffer,
    r.heat.buffer,
    r.lastTouch.buffer,
    r.commits.buffer,
    r.author.buffer,
    r.type.buffer,
    r.firstTime.buffer,
    r.folderRects.buffer,
    r.folderDepth.buffer,
  ] as Transferable[];
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapController } from '../map/MapController';
import { readPalette, type Mode, type Palette } from '../map/colors';
import { baseName } from '../map/render';
import { useMap } from '../store/map';
import { clock, subscribeClock } from '../map/clock';
import { useMeaning } from '../store/meaning';
import { useUi } from '../store/ui';
import { atlasWorker } from '../lib/atlasClient';
import { usePrefersReducedMotion } from '../lib/motion';
import type { FromWorker, LayoutPayload, Summary } from '../lib/protocol';
import { Tooltip, type TooltipData } from './Tooltip';
import { Ticker } from './Ticker';
import '../styles/map.css';

/**
 * The map. React owns the element and the chrome around it; everything that
 * happens per pointer move or per frame lives in the controller.
 */
export function MapView({ summary }: { summary: Summary }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();

  const theme = useUi((s) => s.theme);
  const mode = useMap((s) => s.mode);
  const root = useMap((s) => s.root);
  const tables = useMap((s) => s.tables);
  const hits = useMeaning((s) => s.hits);
  const profile = useMeaning((s) => s.profile);
  const layout = useMap((s) => s.layout);
  const layoutVersion = layout?.id ?? 0;
  const selectedFile = useMap((s) => s.selectedFile);

  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [pal, setPal] = useState<Palette | null>(null);

  /** Layout requests are numbered so a stale reply can be dropped. */
  const reqId = useRef(0);
  const pendingZoom = useRef<{ rect: [number, number, number, number]; into: boolean } | null>(null);
  const size = useRef({ w: 0, h: 0 });
  const requestRef = useRef<(commit: number) => void>(() => undefined);

  const controller = useMemo(
    () =>
      new MapController({
        onHoverCell: (index, clientX, clientY) => {
          const l = controllerRef.current?.currentLayout();
          const t = useMap.getState().tables;
          if (index < 0 || !l || !t) {
            setTooltip(null);
            return;
          }
          setTooltip({
            path: t.paths[l.pathIds[index]!]!,
            size: l.size[index]!,
            commits: l.commits[index]!,
            lastTouch: l.lastTouch[index]!,
            fileId: l.fileIds[index]!,
            x: clientX,
            y: clientY,
          });
        },
        onHoverFolder: () => undefined,
        onSelect: (index) => {
          const l = controllerRef.current?.currentLayout();
          useMap.getState().setSelectedFile(index >= 0 && l ? l.fileIds[index]! : -1);
        },
        onNeedLayout: (commit) => requestRef.current(commit),
        onDrill: (path) => {
          const rect = controllerRef.current?.folderRect(path);
          if (rect) pendingZoom.current = { rect, into: true };
          useMap.getState().setRoot(path);
        },
      }),
    [],
  );
  const controllerRef = useRef(controller);

  // ---- worker layout requests ----
  const request = useCallback((commit: number) => {
    const { w, h } = size.current;
    if (w < 2 || h < 2) return;
    reqId.current += 1;
    atlasWorker().postMessage({
      type: 'layout',
      request: {
        id: reqId.current,
        commit,
        width: w,
        height: h,
        root: useMap.getState().root,
      },
    });
  }, []);
  requestRef.current = request;

  useEffect(() => {
    const w = atlasWorker();
    const onMessage = (e: MessageEvent<FromWorker>) => {
      if (e.data.type !== 'layout') return;
      const layout: LayoutPayload = e.data.layout;
      if (layout.id !== reqId.current) return; // a newer request is already out
      const zoom = pendingZoom.current;
      pendingZoom.current = null;
      controllerRef.current.setLayout(layout, zoom ?? undefined);
      useMap.getState().setLayout(layout);
      // Cell indices are per-layout, so the selection has to be re-resolved.
      const file = useMap.getState().selectedFile;
      if (file >= 0) {
        let cell = -1;
        for (let i = 0; i < layout.fileIds.length; i++) {
          if (layout.fileIds[i] === file) {
            cell = i;
            break;
          }
        }
        controllerRef.current.select(cell);
      }
    };
    w.addEventListener('message', onMessage);
    return () => w.removeEventListener('message', onMessage);
  }, []);

  // ---- canvases, sizing, palette ----
  useEffect(() => {
    const wrap = wrapRef.current;
    const base = baseRef.current;
    const overlay = overlayRef.current;
    if (!wrap || !base || !overlay) return;

    const c = controllerRef.current;
    c.attach(base, overlay);
    c.reducedMotion = reduced;
    c.setTimeRange(summary.firstTime, summary.lastTime);

    c.fileCount = summary.files;

    let lastW = 0;
    let lastH = 0;
    const ro = new ResizeObserver(() => {
      const w = Math.floor(wrap.clientWidth);
      const h = Math.floor(wrap.clientHeight);
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      size.current = { w, h };
      c.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
      request(clock.commit);
    });
    ro.observe(wrap);

    return () => {
      ro.disconnect();
      c.detach();
    };
  }, [reduced, request, summary.files, summary.firstTime, summary.lastTime]);

  useEffect(() => {
    const p = readPalette(document.documentElement);
    setPal(p);
    controllerRef.current.setPalette(p);
  }, [theme]);

  useEffect(() => {
    if (tables) controllerRef.current.setTables(tables);
  }, [tables]);

  useEffect(() => {
    controllerRef.current.setMode(mode);
  }, [mode]);

  // A new root or weighting needs a fresh layout at the current commit.
  useEffect(() => {
    request(clock.commit);
  }, [root, request]);

  /*
   * Whenever the clock settles somewhere new — the timeline finishing, a step,
   * Home/End, a seek — ask for that commit's layout. While playing, the
   * controller drives the requests itself from inside the frame loop.
   */
  useEffect(
    () =>
      subscribeClock(() => {
        // The loop halts whenever the map is still, so pressing play has to
        // wake it; from then on it keeps itself scheduled.
        if (clock.playing) {
          controllerRef.current.invalidate();
          return;
        }
        if (clock.scrubbing) return;
        const current = controllerRef.current.currentLayout();
        if (current && current.commit === clock.commit) return;
        request(clock.commit);
      }),
    [request],
  );

  /*
   * Search dims rather than hides: the map keeps its shape, and the matches
   * are the only thing at full strength.
   */
  useEffect(() => {
    const c = controllerRef.current;
    const l = c.currentLayout();
    if (!l) return;
    // A file search wins while it is typed; otherwise a person's files light up.
    const ids: ArrayLike<number> | null =
      hits.length > 0 ? hits.map((h) => h.fileId) : profile ? profile.fileIds : null;
    if (!ids) {
      c.setDimmed(null);
      return;
    }
    const wanted = new Set<number>(Array.from(ids));
    const mask = new Uint8Array(l.fileIds.length);
    for (let i = 0; i < l.fileIds.length; i++) mask[i] = wanted.has(l.fileIds[i]!) ? 0 : 1;
    c.setDimmed(mask);
  }, [hits, profile, layoutVersion]);

  // Selection drives the overlay, not the layout.
  useEffect(() => {
    controllerRef.current.selectedFile = selectedFile;
    controllerRef.current.invalidate();
  }, [selectedFile]);

  // ---- pointer ----
  const onMove = useCallback((e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    controllerRef.current.pointerMove(e.clientX - r.left, e.clientY - r.top, e.clientX, e.clientY);
  }, []);

  const label = useMemo(() => describe(summary, layout, mode, root), [summary, layout, mode, root]);

  return (
    <div
      className="map-wrap"
      ref={wrapRef}
      data-cells={layout?.fileIds.length ?? 0}
      data-layout-ms={layout ? Math.round(layout.tookMs) : ''}
    >
      <canvas ref={baseRef} className="map-canvas" role="img" aria-label={label} />
      <canvas
        ref={overlayRef}
        className="map-canvas map-overlay"
        aria-hidden="true"
        onPointerMove={onMove}
        onPointerLeave={() => {
          controllerRef.current.pointerLeave();
          setTooltip(null);
        }}
        onClick={() => controllerRef.current.click()}
      />
      {tables && pal && <Ticker tables={tables} pal={pal} />}
      {tooltip && pal && <Tooltip data={tooltip} />}
      <div className="map-notes">
        {layout && layout.hiddenCount > 0 && (
          <p className="map-note tiny">
            {layout.hiddenCount.toLocaleString()} file
            {layout.hiddenCount === 1 ? '' : 's'} too small to draw at this size — zoom into a
            folder to see them.
          </p>
        )}
      </div>
    </div>
  );
}

/** What a screen reader gets instead of the picture. */
function describe(summary: Summary, l: LayoutPayload | null, mode: Mode, root: string): string {
  if (!l) return 'Treemap of the repository, loading.';
  const where = root === '' ? summary.repo : `the folder ${root}`;
  return (
    `Treemap of ${where}: ${l.fileIds.length.toLocaleString()} files as rectangles, ` +
    `sized by an estimate of each file's length from its line counts, grouped by folder, ` +
    `coloured by ${mode}. Use the Hotspots list or the table view for the same information as text.`
  );
}

export { baseName };

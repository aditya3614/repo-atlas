import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapController } from '../map/MapController';
import { readPalette, type Mode, type Palette } from '../map/colors';
import { baseName } from '../map/render';
import { useMap } from '../store/map';
import { useUi } from '../store/ui';
import { atlasWorker } from '../lib/atlasClient';
import { usePrefersReducedMotion } from '../lib/motion';
import type { FromWorker, LayoutPayload, Summary } from '../lib/protocol';
import { Tooltip, type TooltipData } from './Tooltip';
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
  const weighting = useMap((s) => s.weighting);
  const root = useMap((s) => s.root);
  const tables = useMap((s) => s.tables);

  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [pal, setPal] = useState<Palette | null>(null);

  /** Layout requests are numbered so a stale reply can be dropped. */
  const reqId = useRef(0);
  const pendingZoom = useRef<{ rect: [number, number, number, number]; into: boolean } | null>(null);

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
  const request = useCallback(
    (width: number, height: number) => {
      if (width < 2 || height < 2) return;
      reqId.current += 1;
      atlasWorker().postMessage({
        type: 'layout',
        request: {
          id: reqId.current,
          commit: summary.commits - 1,
          width,
          height,
          root: useMap.getState().root,
          weighting: useMap.getState().weighting,
        },
      });
    },
    [summary.commits],
  );

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

    let lastW = 0;
    let lastH = 0;
    const ro = new ResizeObserver(() => {
      const w = Math.floor(wrap.clientWidth);
      const h = Math.floor(wrap.clientHeight);
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      c.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
      request(w, h);
    });
    ro.observe(wrap);

    return () => {
      ro.disconnect();
      c.detach();
    };
  }, [reduced, request, summary.firstTime, summary.lastTime]);

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

  // A new root or weighting needs a fresh layout at the current size.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (wrap) request(Math.floor(wrap.clientWidth), Math.floor(wrap.clientHeight));
  }, [root, weighting, request]);

  // ---- pointer ----
  const onMove = useCallback((e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    controllerRef.current.pointerMove(e.clientX - r.left, e.clientY - r.top, e.clientX, e.clientY);
  }, []);

  const layout = useMap((s) => s.layout);
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
      {tooltip && pal && <Tooltip data={tooltip} />}
      {layout && layout.hiddenCount > 0 && (
        <p className="map-note tiny">
          {layout.hiddenCount.toLocaleString()} file
          {layout.hiddenCount === 1 ? '' : 's'} too small to draw at this size — zoom into a folder
          to see them.
        </p>
      )}
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

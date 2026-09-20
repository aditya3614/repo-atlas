import { create } from 'zustand';
import type { CoChangePayload, LayoutPayload, Tables, Weighting } from '../lib/protocol';
import type { Mode } from '../map/colors';

interface MapState {
  mode: Mode;
  weighting: Weighting;
  /** Folder the map is drilled into; '' is the repository root. */
  root: string;
  selectedFile: number;
  /** Draw the strongest co-change arcs, not just the selection's. */
  showArcs: boolean;
  tables: Tables | null;
  layout: LayoutPayload | null;
  cochange: CoChangePayload | null;
  setMode: (m: Mode) => void;
  setWeighting: (w: Weighting) => void;
  setRoot: (r: string) => void;
  setSelectedFile: (f: number) => void;
  setShowArcs: (v: boolean) => void;
  setTables: (t: Tables) => void;
  setLayout: (l: LayoutPayload) => void;
  setCoChange: (c: CoChangePayload) => void;
}

export const useMap = create<MapState>((set) => ({
  mode: 'activity',
  weighting: 'balanced',
  root: '',
  selectedFile: -1,
  showArcs: false,
  tables: null,
  layout: null,
  cochange: null,
  setMode: (mode) => set({ mode }),
  setWeighting: (weighting) => set({ weighting }),
  // The selection survives a drill: the file is usually still on screen.
  setRoot: (root) => set({ root }),
  setSelectedFile: (selectedFile) => set({ selectedFile }),
  setShowArcs: (showArcs) => set({ showArcs }),
  setTables: (tables) => set({ tables }),
  setLayout: (layout) => set({ layout }),
  setCoChange: (cochange) => set({ cochange }),
}));

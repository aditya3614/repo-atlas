import { create } from 'zustand';
import type { LayoutPayload, Tables } from '../lib/protocol';
import type { Mode } from '../map/colors';

interface MapState {
  mode: Mode;
  /** Folder the map is drilled into; '' is the repository root. */
  root: string;
  selectedFile: number;
  tables: Tables | null;
  layout: LayoutPayload | null;
  setMode: (m: Mode) => void;
  setRoot: (r: string) => void;
  setSelectedFile: (f: number) => void;
  setTables: (t: Tables) => void;
  setLayout: (l: LayoutPayload) => void;
}

export const useMap = create<MapState>((set) => ({
  mode: 'activity',
  root: '',
  selectedFile: -1,
  tables: null,
  layout: null,
  setMode: (mode) => set({ mode }),
  // The selection survives a drill: the file is usually still on screen.
  setRoot: (root) => set({ root }),
  setSelectedFile: (selectedFile) => set({ selectedFile }),
  setTables: (tables) => set({ tables }),
  setLayout: (layout) => set({ layout }),
}));

import { create } from 'zustand';
import type { InputError, Progress, Summary } from '../lib/protocol';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface AtlasState {
  status: LoadStatus;
  progress: Progress;
  summary: Summary | null;
  error: InputError | null;
  cancel: (() => void) | null;

  begin: (cancel: () => void) => void;
  setProgress: (p: Progress) => void;
  setSummary: (s: Summary) => void;
  setError: (e: InputError) => void;
  reset: () => void;
}

const ZERO: Progress = { commits: 0, files: 0, bytes: 0, totalBytes: 0 };

export const useAtlas = create<AtlasState>((set, get) => ({
  status: 'idle',
  progress: ZERO,
  summary: null,
  error: null,
  cancel: null,

  begin: (cancel) => set({ status: 'loading', progress: ZERO, error: null, summary: null, cancel }),
  setProgress: (progress) => set({ progress }),
  setSummary: (summary) => set({ status: 'ready', summary, cancel: null }),
  setError: (error) => set({ status: 'error', error, cancel: null }),
  reset: () => {
    get().cancel?.();
    set({ status: 'idle', progress: ZERO, summary: null, error: null, cancel: null });
  },
}));

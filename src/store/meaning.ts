import { create } from 'zustand';
import type { FileDetail, MeaningPayload, SearchHit } from '../lib/protocol';

interface MeaningState {
  meaning: MeaningPayload | null;
  detail: FileDetail | null;
  query: string;
  hits: SearchHit[];
  searchOpen: boolean;
  setMeaning: (m: MeaningPayload) => void;
  setDetail: (d: FileDetail | null) => void;
  setQuery: (q: string) => void;
  setHits: (q: string, hits: SearchHit[]) => void;
  setSearchOpen: (v: boolean) => void;
}

export const useMeaning = create<MeaningState>((set, get) => ({
  meaning: null,
  detail: null,
  query: '',
  hits: [],
  searchOpen: false,
  setMeaning: (meaning) => set({ meaning }),
  setDetail: (detail) => set({ detail }),
  setQuery: (query) => set({ query, ...(query === '' ? { hits: [] } : {}) }),
  // A reply for a query the user has already moved on from is dropped.
  setHits: (q, hits) => {
    if (get().query === q) set({ hits });
  },
  setSearchOpen: (searchOpen) =>
    set(searchOpen ? { searchOpen } : { searchOpen, query: '', hits: [] }),
}));

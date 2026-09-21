import { create } from 'zustand';
import type {
  AuthorCommit,
  AuthorProfile,
  CommitFile,
  FileDetail,
  MeaningPayload,
  PersonHit,
  SearchHit,
} from '../lib/protocol';

interface MeaningState {
  meaning: MeaningPayload | null;
  detail: FileDetail | null;
  query: string;
  hits: SearchHit[];
  people: PersonHit[];
  searchOpen: boolean;

  /** The person being looked at, if any, and the commits loaded for them. */
  profile: AuthorProfile | null;
  profileCommits: AuthorCommit[];
  profileMore: boolean;
  /** Files of the commits the person has opened, by commit index. */
  commitFiles: Record<number, { files: CommitFile[]; total: number }>;

  setMeaning: (m: MeaningPayload) => void;
  setDetail: (d: FileDetail | null) => void;
  setQuery: (q: string) => void;
  setHits: (q: string, hits: SearchHit[], people: PersonHit[]) => void;
  setSearchOpen: (v: boolean) => void;

  setProfile: (p: AuthorProfile | null) => void;
  addProfileCommits: (author: number, commits: AuthorCommit[], more: boolean) => void;
  setCommitFiles: (commit: number, files: CommitFile[], total: number) => void;
}

export const useMeaning = create<MeaningState>((set, get) => ({
  meaning: null,
  detail: null,
  query: '',
  hits: [],
  people: [],
  searchOpen: false,
  profile: null,
  profileCommits: [],
  profileMore: false,
  commitFiles: {},

  setMeaning: (meaning) => set({ meaning }),
  setDetail: (detail) => set({ detail }),
  setQuery: (query) => set({ query, ...(query === '' ? { hits: [], people: [] } : {}) }),
  // A reply for a query the user has already moved on from is dropped.
  setHits: (q, hits, people) => {
    if (get().query === q) set({ hits, people });
  },
  // Closing search clears the query, but not the person it led to.
  setSearchOpen: (searchOpen) =>
    set(searchOpen ? { searchOpen } : { searchOpen, query: '', hits: [], people: [] }),

  setProfile: (profile) =>
    set({
      profile,
      profileCommits: profile?.recent ?? [],
      profileMore: profile?.moreRecent ?? false,
      commitFiles: {},
    }),
  addProfileCommits: (author, commits, more) => {
    const p = get().profile;
    if (!p || p.id !== author) return;
    set({ profileCommits: [...get().profileCommits, ...commits], profileMore: more });
  },
  setCommitFiles: (commit, files, total) =>
    set({ commitFiles: { ...get().commitFiles, [commit]: { files, total } } }),
}));

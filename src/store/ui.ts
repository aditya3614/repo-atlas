import { create } from 'zustand';

export type Theme = 'night' | 'paper';
export type Screen = 'landing' | 'loading' | 'main';

const THEME_KEY = 'atlas.theme';

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'paper' || t === 'night') return t;
  } catch {
    /* private mode: fall through to the default */
  }
  return 'night';
}

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
}

interface UiState {
  theme: Theme;
  screen: Screen;
  toasts: Toast[];
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setScreen: (s: Screen) => void;
  toast: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
}

let toastId = 0;

export const useUi = create<UiState>((set, get) => ({
  theme: readTheme(),
  screen: 'landing',
  toasts: [],

  setTheme: (theme) => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* theme still applies for this session */
    }
    set({ theme });
  },

  toggleTheme: () => get().setTheme(get().theme === 'night' ? 'paper' : 'night'),

  setScreen: (screen) => set({ screen }),

  toast: (message, tone = 'info') => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, message, tone }] });
    window.setTimeout(() => get().dismissToast(id), 2600);
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

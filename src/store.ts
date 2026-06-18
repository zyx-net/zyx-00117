import { create } from 'zustand';
import type { User } from './types';
import { api } from './api';

interface AppState {
  user: User | null;
  initialized: boolean;
  toast: { message: string; type: 'success' | 'error' | 'info' } | null;

  init: () => Promise<void>;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;

  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  clearToast: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  initialized: false,
  toast: null,

  init: async () => {
    const res = await api.me();
    if (res.success && res.data) {
      set({ user: res.data, initialized: true });
    } else {
      set({ user: null, initialized: true });
    }
  },

  login: async (username, password) => {
    const res = await api.login(username, password);
    if (res.success && res.data) {
      set({ user: res.data });
      return { success: true };
    }
    return { success: false, error: res.error };
  },

  logout: async () => {
    await api.logout();
    set({ user: null });
  },

  showToast: (message, type = 'info') => {
    set({ toast: { message, type } });
    setTimeout(() => set({ toast: null }), 3000);
  },

  clearToast: () => set({ toast: null }),
}));

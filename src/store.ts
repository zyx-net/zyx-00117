import { create } from 'zustand';
import type { User } from './types';
import { api } from './api';

interface AppState {
  user: User | null;
  initialized: boolean;
  toast: { message: string; type: 'success' | 'error' | 'info' } | null;
  unreadNotificationCount: number;

  init: () => Promise<void>;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;

  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  clearToast: () => void;

  refreshUnreadCount: () => Promise<void>;
  decrementUnreadCount: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  initialized: false,
  toast: null,
  unreadNotificationCount: 0,

  init: async () => {
    const res = await api.me();
    if (res.success && res.data) {
      set({ user: res.data, initialized: true });
      get().refreshUnreadCount();
    } else {
      set({ user: null, initialized: true });
    }
  },

  login: async (username, password) => {
    const res = await api.login(username, password);
    if (res.success && res.data) {
      set({ user: res.data });
      get().refreshUnreadCount();
      return { success: true };
    }
    return { success: false, error: res.error };
  },

  logout: async () => {
    await api.logout();
    set({ user: null, unreadNotificationCount: 0 });
  },

  showToast: (message, type = 'info') => {
    set({ toast: { message, type } });
    setTimeout(() => set({ toast: null }), 3000);
  },

  clearToast: () => set({ toast: null }),

  refreshUnreadCount: async () => {
    const user = get().user;
    if (!user) return;
    const res = await api.listNotifications();
    if (res.success && res.data) {
      set({ unreadNotificationCount: res.data.unreadCount });
    }
  },

  decrementUnreadCount: () => {
    set((state) => ({
      unreadNotificationCount: Math.max(0, state.unreadNotificationCount - 1),
    }));
  },
}));

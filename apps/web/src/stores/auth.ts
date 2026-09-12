import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../lib/api';
import { getToken, setToken } from '../lib/token';
import type { PublicUser } from '../lib/types';

interface AuthState {
  token: string;
  user: PublicUser | null;
  /** 最近一次 /api/me 返回的打卡天数（展示用缓存） */
  streak: number;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, nickname: string) => Promise<void>;
  /** 拉取最新用户信息与 streak（进入应用/设置页时调用） */
  refreshMe: () => Promise<void>;
  setUser: (user: PublicUser) => void;
  setStreak: (streak: number) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: '',
      user: null,
      streak: 0,

      login: async (email, password) => {
        const { token, user } = await api.login(email, password);
        setToken(token);
        set({ token, user });
      },

      register: async (email, password, nickname) => {
        const { token, user } = await api.register(email, password, nickname);
        setToken(token);
        set({ token, user });
      },

      refreshMe: async () => {
        if (!getToken()) return;
        const me = await api.me();
        set({ user: me.user, streak: me.streak });
      },

      setUser: (user) => set({ user }),

      setStreak: (streak) => set({ streak }),

      logout: () => {
        setToken('');
        set({ token: '', user: null });
      },
    }),
    {
      name: 'wordflow.auth',
      partialize: (s) => ({ token: s.token, user: s.user }),
      onRehydrateStorage: () => (state) => {
        // localStorage 里恢复的 token 与实际存储保持一致
        if (state?.token && !getToken()) setToken(state.token);
      },
    },
  ),
);

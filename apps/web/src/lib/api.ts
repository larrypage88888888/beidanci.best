import { getToken, setToken } from './token';
import type {
  MeResponse,
  MyWordsResponse,
  PlacementQuestion,
  PlacementResult,
  PublicUser,
  ReviewsResponse,
  TodayResponse,
} from './types';

/** 极薄 fetch 封装：JSON + Bearer Token + 统一错误 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { ...init, headers });
  const data = (await res.json().catch(() => null)) as (T & { message?: string }) | null;

  if (!res.ok) {
    // 会话失效（过期/被删设备）：清除本地凭证并广播，由 App 统一登出跳登录页。
    // 注意 /api/auth/* 的 401 是正常业务错误（密码错误），不触发。
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      setToken('');
      window.dispatchEvent(new CustomEvent('wordflow:unauthorized'));
    }
    throw new ApiError(res.status, data?.message ?? `请求失败（${res.status}）`);
  }
  return data as T;
}

export const api = {
  register: (email: string, password: string, nickname: string) =>
    request<{ token: string; user: PublicUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, nickname }),
    }),

  login: (email: string, password: string) =>
    request<{ token: string; user: PublicUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<MeResponse>('/api/me'),

  /** 我的词库（已学单词列表 + 艾宾浩斯状态） */
  myWords: (params: { filter?: string; sort?: string; page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams(
      Object.entries({
        filter: params.filter ?? 'all',
        sort: params.sort ?? 'recent',
        page: String(params.page ?? 1),
        pageSize: String(params.pageSize ?? 20),
      }),
    ).toString();
    return request<MyWordsResponse>(`/api/words?${qs}`);
  },

  updateMe: (patch: Partial<Pick<PublicUser, 'nickname' | 'dailyNewLimit' | 'scheduleMode'>>) =>
    request<{ user: PublicUser }>('/api/me', { method: 'PATCH', body: JSON.stringify(patch) }),

  today: () => request<TodayResponse>('/api/today'),

  submitReviews: (items: Array<{ wordId: string; rating: string; latencyMs?: number }>) =>
    request<ReviewsResponse>('/api/reviews', { method: 'POST', body: JSON.stringify({ items }) }),

  placementStart: () =>
    request<{ question: PlacementQuestion; progress: { current: number; total: number }; sessionToken: string }>(
      '/api/placement/start',
      { method: 'POST' },
    ),

  placementAnswer: (
    sessionToken: string,
    wordId: string,
    correct: boolean,
  ) =>
    request<
      | { done: false; question: PlacementQuestion; progress: { current: number; total: number }; sessionToken: string }
      | { done: true; result: PlacementResult }
    >('/api/placement/answer', {
      method: 'POST',
      body: JSON.stringify({ sessionToken, wordId, correct }),
    }),

  /** 本地测试工具：把最早到期的 N 个已学词拉回到现在（仅 DEV_MODE=1 可用） */
  devReviewNow: (count = 3) =>
    request<{ wordIds: string[] }>('/api/dev/review-now', {
      method: 'POST',
      body: JSON.stringify({ count }),
    }),
};

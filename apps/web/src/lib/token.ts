/** JWT 存取（localStorage），api 层与 auth store 共用，避免循环依赖 */

const KEY = 'wordflow.token';

export function getToken(): string {
  return localStorage.getItem(KEY) ?? '';
}

export function setToken(token: string): void {
  if (token) localStorage.setItem(KEY, token);
  else localStorage.removeItem(KEY);
}

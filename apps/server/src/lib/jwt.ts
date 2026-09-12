/**
 * JWT(HS256) 签发/校验 —— 基于 Web Crypto，Cloudflare Workers 原生兼容。
 */

const encoder = new TextEncoder();

export interface JwtPayload {
  sub?: string;
  purpose?: string;
  exp?: number;
  iat?: number;
  [key: string]: unknown;
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function signJwt(
  payload: JwtPayload,
  secret: string,
  expiresInSeconds = 7 * 24 * 3600,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const body: JwtPayload = { ...payload, iat: now, exp: now + expiresInSeconds };
  const header = { alg: 'HS256', typ: 'JWT' };
  const signingInput =
    bytesToB64url(encoder.encode(JSON.stringify(header))) +
    '.' +
    bytesToB64url(encoder.encode(JSON.stringify(body)));

  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput)));
  return `${signingInput}.${bytesToB64url(sig)}`;
}

/** 校验并解析 JWT；非法或过期返回 null */
export async function verifyJwt(token: string, secret: string, purpose?: string): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;

  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify('HMAC', key, b64urlToBytes(s), encoder.encode(`${h}.${p}`));
  if (!valid) return null;

  let payload: JwtPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p))) as JwtPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
  if (purpose && payload.purpose !== purpose) return null;
  return payload;
}

/** 生成随机 id（用户/日志主键） */
export function randomId(): string {
  return crypto.randomUUID();
}

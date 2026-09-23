import type { ApiResponse, SessionUser } from '@csumroh/shared-types';

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';
const apiOrigin = baseUrl.replace(/\/api\/v1\/?$/, '');
let accessToken: string | null = null;
export const setAccessToken = (token: string | null) => { accessToken = token; };
export const getAccessToken = () => accessToken;

export type SessionPayload = { accessToken: string; user: SessionUser };

type SessionListener = (session: SessionPayload | null) => void;
const sessionListeners = new Set<SessionListener>();

/**
 * Dipanggil setiap refresh selesai: payload baru bila sukses, null bila sesi sudah tidak berlaku
 * (refresh token dicabut/kedaluwarsa). AuthProvider memakai ini untuk logout terpusat,
 * socket memakainya untuk reconnect dengan token baru.
 */
export function onSessionChange(listener: SessionListener) {
  sessionListeners.add(listener);
  return () => { sessionListeners.delete(listener); };
}

let refreshInFlight: Promise<SessionPayload | null> | null = null;

/**
 * Refresh token dirotasi backend: token lama dicabut begitu dipakai. Beberapa request yang
 * mendapat 401 bersamaan harus berbagi SATU refresh; refresh paralel membuat request kedua
 * memakai token yang sudah dicabut dan sesi terputus.
 */
export function refreshSession(): Promise<SessionPayload | null> {
  if (!refreshInFlight) {
    const request = () => fetch(`${baseUrl}/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) return null;
        const body = await response.json() as ApiResponse<SessionPayload>;
        return body.data ?? null;
      });
    // Antartab: refresh diserialkan dengan Web Locks, sehingga tab kedua mengirim cookie yang sudah
    // diperbarui tab pertama, bukan token lama yang baru saja dirotasi.
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    refreshInFlight = (locks ? (locks.request('csumroh-auth-refresh', request) as unknown as Promise<SessionPayload | null>) /* lib.dom mengetik hasil ganda; runtime sudah flatten */ : request())
      .catch(() => null)
      .then((session) => {
        setAccessToken(session?.accessToken ?? null);
        sessionListeners.forEach((listener) => listener(session));
        return session;
      })
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

class SessionExpiredError extends Error {
  constructor() { super('Sesi berakhir. Silakan login kembali.'); }
}

async function raw<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...options.headers },
  });
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    const session = await refreshSession();
    if (session) return raw(path, options, false);
    throw new SessionExpiredError();
  }
  const body = await response.json().catch(() => ({ success: false, error: 'Respons server tidak valid.' })) as { success?: boolean; data?: T; error?: string };
  if (!response.ok || !body.success) throw new Error(body.error ?? 'Permintaan gagal.');
  return body.data as T;
}

/**
 * Unduh berkas privat (mis. bukti transfer) dengan header Authorization. <img src> biasa
 * tidak membawa Bearer token, jadi berkas privat harus diambil sebagai blob.
 */
async function rawBlob(path: string, retry = true): Promise<Blob> {
  const url = path.startsWith('http') ? path : `${apiOrigin}${path}`;
  const response = await fetch(url, {
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (response.status === 401 && retry) {
    const session = await refreshSession();
    if (session) return rawBlob(path, false);
    throw new SessionExpiredError();
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? 'Berkas tidak dapat dimuat.');
  }
  return response.blob();
}

export const api = {
  blob: (path: string) => rawBlob(path),
  get: <T>(path: string) => raw<T>(path),
  post: <T>(path: string, body?: unknown) => raw<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) => raw<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => raw<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => raw<T>(path, { method: 'DELETE' }),
};

export function resolveMediaUrl(url?: string | null): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:') || url.startsWith('data:')) {
    return url;
  }
  const clean = url.startsWith('/') ? url : `/${url}`;
  return `${apiOrigin}${clean}`;
}

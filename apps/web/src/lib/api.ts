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
 * Refresh gagal karena gangguan sementara (jaringan putus, 429 dibatasi, 5xx/DB tidak tersedia), bukan karena sesi
 * berakhir. Sesi dan cookie refresh masih berlaku: pengguna tidak boleh dikeluarkan, cukup dicoba lagi nanti.
 */
export class SessionRefreshUnavailableError extends Error {
  status = 503;
  constructor() { super('Koneksi ke server sedang terganggu. Coba lagi sebentar.'); }
}

const REFRESH_RETRY_DELAYS_MS = [1_000, 3_000];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Refresh token dirotasi backend: token lama dicabut begitu dipakai. Beberapa request yang
 * mendapat 401 bersamaan harus berbagi SATU refresh; refresh paralel membuat request kedua
 * memakai token yang sudah dicabut dan sesi terputus.
 *
 * Hasil: payload baru bila sukses, null HANYA bila server menolak sesi (401/403). Gangguan sementara dicoba ulang
 * sebentar, lalu dilempar sebagai SessionRefreshUnavailableError tanpa mengubah status login.
 */
export function refreshSession(): Promise<SessionPayload | null> {
  if (!refreshInFlight) {
    const attempt = async (): Promise<SessionPayload | null> => {
      for (let index = 0; ; index += 1) {
        const response = await fetch(`${baseUrl}/auth/refresh`, { method: 'POST', credentials: 'include' }).catch(() => null);
        if (response && (response.status === 401 || response.status === 403)) return null;
        if (response?.ok) {
          const body = await response.json().catch(() => null) as ApiResponse<SessionPayload> | null;
          if (body?.data) return body.data;
        }
        if (index >= REFRESH_RETRY_DELAYS_MS.length) throw new SessionRefreshUnavailableError();
        await wait(REFRESH_RETRY_DELAYS_MS[index]!);
      }
    };
    // Antartab: refresh diserialkan dengan Web Locks, sehingga tab kedua mengirim cookie yang sudah
    // diperbarui tab pertama, bukan token lama yang baru saja dirotasi.
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    refreshInFlight = (locks ? (locks.request('csumroh-auth-refresh', attempt) as unknown as Promise<SessionPayload | null>) /* lib.dom mengetik hasil ganda; runtime sudah flatten */ : attempt())
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
  if (!response.ok || !body.success) {
    // Status HTTP ikut dibawa: pemanggil membedakan penolakan validasi (4xx) dari gangguan jaringan/server.
    throw Object.assign(new Error(body.error ?? 'Permintaan gagal.'), { status: response.status });
  }
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

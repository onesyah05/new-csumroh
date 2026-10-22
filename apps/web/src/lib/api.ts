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

/** Batas waktu permintaan: jaringan yang menggantung tidak boleh menahan spinner dan mutasi tanpa akhir. */
const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;
const BLOB_TIMEOUT_MS = 60_000;
const UPLOAD_PATH = /\/messages\/media$|\/gallery\/assets$|upload-|\/flyer$|\/itinerary-template$|\/payment-proof(-upload)?$/;
const withTimeout = (ms: number) => (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined);
const isTimeout = (error: unknown) => error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError');
const timeoutError = () => Object.assign(new Error('Server tidak merespons. Periksa koneksi lalu coba lagi.'), { status: 504 });

/** Hanya origin API yang boleh menerima token dan cookie sesi. */
export function isApiUrl(url: string) {
  try {
    const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost';
    return new URL(url, base).origin === new URL(apiOrigin || '/', base).origin;
  } catch {
    return false;
  }
}

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
        const response = await fetch(`${baseUrl}/auth/refresh`, { method: 'POST', credentials: 'include', signal: withTimeout(15_000) }).catch(() => null);
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
    signal: withTimeout(UPLOAD_PATH.test(path) ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS),
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...options.headers },
  }).catch((error: unknown) => { throw isTimeout(error) ? timeoutError() : error; });
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    const session = await refreshSession();
    if (session) return raw(path, options, false);
    throw new SessionExpiredError();
  }
  const body = await response.json().catch(() => ({ success: false, error: 'Respons server tidak valid.' })) as { success?: boolean; data?: T; error?: string; details?: unknown };
  if (!response.ok || !body.success) {
    // Status HTTP ikut dibawa: pemanggil membedakan penolakan validasi (4xx) dari gangguan jaringan/server.
    throw Object.assign(new Error(body.error ?? 'Permintaan gagal.'), { status: response.status, details: body.details });
  }
  return body.data as T;
}

/**
 * Unduh berkas privat (mis. bukti transfer) dengan header Authorization. <img src> biasa
 * tidak membawa Bearer token, jadi berkas privat harus diambil sebagai blob.
 */
async function rawBlob(path: string, retry = true): Promise<Blob> {
  const url = path.startsWith('http') ? path : `${apiOrigin}${path}`;
  // Token dan cookie hanya untuk origin API; URL absolut ke host lain diambil tanpa kredensial.
  const trusted = isApiUrl(url);
  const response = await fetch(url, {
    credentials: trusted ? 'include' : 'omit',
    headers: trusted && accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    signal: withTimeout(BLOB_TIMEOUT_MS),
  }).catch((error: unknown) => { throw isTimeout(error) ? timeoutError() : error; });
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
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) return url;
  // data: hanya untuk gambar; jenis lain (html, svg aktif, dll.) tidak dirender.
  if (url.startsWith('data:')) return /^data:image\/(?:png|jpe?g|webp|gif);/i.test(url) ? url : '';
  const clean = url.startsWith('/') ? url : `/${url}`;
  return `${apiOrigin}${clean}`;
}

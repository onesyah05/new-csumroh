import type { ApiResponse } from '@csumroh/shared-types';

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';
let accessToken: string | null = null;
export const setAccessToken = (token: string | null) => { accessToken = token; };
export const getAccessToken = () => accessToken;

async function raw<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...options.headers },
  });
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    const refreshed = await fetch(`${baseUrl}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (refreshed.ok) {
      const body = await refreshed.json() as ApiResponse<{ accessToken: string }>;
      setAccessToken(body.data.accessToken);
      return raw(path, options, false);
    }
  }
  const body = await response.json().catch(() => ({ success: false, error: 'Respons server tidak valid.' })) as { success?: boolean; data?: T; error?: string };
  if (!response.ok || !body.success) throw new Error(body.error ?? 'Permintaan gagal.');
  return body.data as T;
}

export const api = {
  get: <T>(path: string) => raw<T>(path),
  post: <T>(path: string, body?: unknown) => raw<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) => raw<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => raw<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
};

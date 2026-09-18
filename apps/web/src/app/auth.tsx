import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SessionUser } from '@csumroh/shared-types';
import { api, setAccessToken } from '../lib/api';

type AuthValue = { user: SessionUser | null; loading: boolean; login(email: string, password: string): Promise<void>; logout(): Promise<void> };
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.post<{ accessToken: string; user: SessionUser }>('/auth/refresh').then((data) => { setAccessToken(data.accessToken); setUser(data.user); }).catch(() => null).finally(() => setLoading(false)); }, []);
  const value = useMemo<AuthValue>(() => ({
    user, loading,
    async login(email, password) { const data = await api.post<{ accessToken: string; user: SessionUser }>('/auth/login', { email, password }); setAccessToken(data.accessToken); setUser(data.user); },
    async logout() { await api.post('/auth/logout').catch(() => null); setAccessToken(null); setUser(null); },
  }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('AuthProvider missing'); return value; }

import { clearProfileDrafts } from '../features/chat/profileDraft';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SessionUser } from '@csumroh/shared-types';
import { api, onSessionChange, refreshSession, setAccessToken, type SessionPayload } from '../lib/api';
import { queryClient } from './query';

type AuthValue = { user: SessionUser | null; loading: boolean; login(email: string, password: string): Promise<void>; logout(): Promise<void> };
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Setiap refresh (awal maupun karena access token kedaluwarsa) memperbarui user — termasuk
    // perubahan role/brand — atau mengakhiri sesi secara terpusat bila refresh ditolak.
    const unsubscribe = onSessionChange((session) => {
      if (session) {
        setUser(session.user);
        return;
      }
      setUser((current) => {
        if (current) queryClient.clear();
        return null;
      });
    });
    // refreshSession() berbagi satu request, jadi efek ganda StrictMode tidak memutar token dua kali.
    void refreshSession().finally(() => setLoading(false));
    return unsubscribe;
  }, []);

  const value = useMemo<AuthValue>(() => ({
    user, loading,
    async login(email, password) { const data = await api.post<SessionPayload>('/auth/login', { email, password }); setAccessToken(data.accessToken); setUser(data.user); },
    async logout() {
      await api.post('/auth/logout').catch(() => null);
      setAccessToken(null);
      setUser(null);
      queryClient.clear();
      clearProfileDrafts();
    },
  }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('AuthProvider missing'); return value; }

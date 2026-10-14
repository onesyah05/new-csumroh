// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  listeners: new Set<(session: unknown) => void>(),
  userA: { id: 1, name: 'A', email: 'a@x.id', role: 'cs', brandId: 1, brand: null, userBrands: [] },
  userB: { id: 2, name: 'B', email: 'b@x.id', role: 'superadmin', brandId: null, brand: null, userBrands: [] },
}));

vi.mock('../lib/api', () => ({
  api: { post: vi.fn(async () => null) },
  setAccessToken: vi.fn(),
  refreshSession: vi.fn(async () => ({ accessToken: 't', user: hoisted.userA })),
  onSessionChange: (listener: (session: unknown) => void) => { hoisted.listeners.add(listener); return () => hoisted.listeners.delete(listener); },
}));

import { AuthProvider, useAuth } from './auth';
import { queryClient } from './query';
import { useUiStore } from './store';

let latest: ReturnType<typeof useAuth> | null = null;
function Probe() { latest = useAuth(); return null; }
const emit = (session: unknown) => act(async () => { hoisted.listeners.forEach((listener) => listener(session)); });

beforeEach(() => {
  latest = null;
  queryClient.clear();
  useUiStore.setState({ activeBrandId: null });
  sessionStorage.clear();
});
afterEach(() => cleanup());

async function mount() {
  render(<AuthProvider><Probe /></AuthProvider>);
  // Sesi awal dimuat lewat listener (refreshSession pada aplikasi nyata).
  await emit({ accessToken: 't', user: hoisted.userA });
}

describe('Pergantian akun di tab yang sama', () => {
  it('refresh yang mengembalikan akun lain membersihkan cache, draf, dan brand aktif', async () => {
    await mount();
    queryClient.setQueryData(['conversations', 1], [{ id: 1 }]);
    useUiStore.setState({ activeBrandId: 1 });
    sessionStorage.setItem('azhan.inbox.1:1.filter', 'followup');
    await emit({ accessToken: 't2', user: hoisted.userB });
    expect(queryClient.getQueryData(['conversations', 1])).toBeUndefined();
    expect(useUiStore.getState().activeBrandId).toBeNull();
    expect(sessionStorage.getItem('azhan.inbox.1:1.filter')).toBeNull();
    expect(latest?.user?.id).toBe(2);
  });

  it('refresh akun yang sama tidak mengosongkan cache', async () => {
    await mount();
    queryClient.setQueryData(['conversations', 1], [{ id: 1 }]);
    await emit({ accessToken: 't3', user: hoisted.userA });
    expect(queryClient.getQueryData(['conversations', 1])).toEqual([{ id: 1 }]);
  });

  it('sesi berakhir membersihkan cache dan brand aktif', async () => {
    await mount();
    queryClient.setQueryData(['prospects', 1], [{ id: 5 }]);
    useUiStore.setState({ activeBrandId: 1 });
    await emit(null);
    expect(queryClient.getQueryData(['prospects', 1])).toBeUndefined();
    expect(useUiStore.getState().activeBrandId).toBeNull();
    expect(latest?.user).toBeNull();
  });
});

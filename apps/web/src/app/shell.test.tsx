// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { AuthProvider } from './auth';
import { queryClient } from './query';

vi.mock('socket.io-client', () => ({ io: () => ({ on: vi.fn(), close: vi.fn(), connect: vi.fn(), connected: true }) }));

const brands = [{ id: 1, name: 'Hana Tours', code: 'HANA' }, { id: 2, name: 'Azhan Umroh', code: 'AZH' }];

function response(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as Response);
}

function renderAs(role: string, url: string) {
  const user = { id: 3, name: 'Tester', email: 't@x.id', role, brandId: 1, brand: brands[0], userBrands: [] };
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes('/auth/refresh')) return response({ accessToken: 't', user });
    if (u.includes('/catalog/brands')) return response(brands);
    if (u.includes('/verification/queue')) return response({ submitted: [], candidates: [] });
    if (u.includes('/unread-count')) return response({ total: 0, urgent: 0 });
    if (u.includes('/prospects')) return response([]);
    return response([]);
  }));
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <AuthProvider><App /></AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => queryClient.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Shell aplikasi', () => {
  it('Finance: tanpa Akademi CS, tetap punya Kotak masuk; pemilih brand header tidak tampil di Verifikasi', async () => {
    renderAs('finance', '/verifikasi');
    await screen.findByRole('heading', { name: 'Verifikasi Pembayaran' }, { timeout: 8000 });
    expect(screen.queryByRole('link', { name: /akademi cs/i })).toBeNull();
    expect(screen.getByRole('link', { name: /^kotak masuk$/i })).toBeTruthy();
    // Halaman lintas brand memakai filternya sendiri: tidak ada dua pemilih brand yang bertentangan.
    expect(screen.queryByRole('combobox', { name: 'Brand aktif' })).toBeNull();
  }, 15_000);

  it('Pipeline mengikuti brand aktif: pemilih brand header tampil', async () => {
    renderAs('admin', '/pipeline');
    await screen.findByRole('heading', { name: 'Pipeline' }, { timeout: 8000 });
    expect(await screen.findByRole('combobox', { name: 'Brand aktif' })).toBeTruthy();
  }, 15_000);
});

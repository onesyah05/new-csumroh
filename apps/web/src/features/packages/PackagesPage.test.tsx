// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { packagesListUrl } from './listLocation';

vi.mock('../../app/auth', () => ({ useAuth: () => ({ user: { id: 1, role: 'superadmin', brandId: null, userBrands: [] } }) }));

import { PackagesPage } from './PackagesPage';

const packages = Array.from({ length: 15 }, (_, i) => ({
  id: i + 1, name: `Paket ${i + 1}`, brandId: 1, brand: { id: 1, name: 'Hana Tours' }, isActive: true, isPromo: false,
  quotaTotal: 45, quotaRemaining: 10, departureDate: '2027-01-11', priceQuad: 29_900_000,
}));

function json(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as Response);
}

let currentUrl = '';
function UrlProbe() {
  const location = useLocation();
  currentUrl = `${location.pathname}${location.search}`;
  return null;
}

function renderAt(url: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <UrlProbe />
        <Routes><Route path="/packages" element={<PackagesPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Daftar paket: halaman tetap setelah kembali', () => {
  beforeEach(() => {
    queryClient.clear();
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => json(String(input).includes('/catalog/packages') ? packages : [])));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('dibuka dari alamat ?page=2 (kembali dari detail/edit) menampilkan halaman 2, bukan halaman 1', async () => {
    renderAt('/packages?brand=all&page=2');
    expect((await screen.findAllByText('Paket 11')).length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Paket 1')).toHaveLength(0);
    expect(packagesListUrl()).toBe('/packages?brand=all&page=2');
  });

  it('filter bulan dari alamat kembali ikut dipulihkan, bukan dibuang', async () => {
    renderAt('/packages?brand=all&month=2027-01&page=2');
    expect((await screen.findAllByText('Paket 11')).length).toBeGreaterThan(0);
    expect(currentUrl).toBe('/packages?brand=all&month=2027-01&page=2');
    expect(packagesListUrl()).toBe('/packages?brand=all&month=2027-01&page=2');
  });

  it('pindah halaman dicatat di URL dan di alamat kembali detail/edit paket', async () => {
    renderAt('/packages');
    expect((await screen.findAllByText('Paket 1')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }));
    expect((await screen.findAllByText('Paket 11')).length).toBeGreaterThan(0);
    expect(currentUrl).toBe('/packages?brand=all&page=2');
    expect(packagesListUrl()).toBe('/packages?brand=all&page=2');
  });
});

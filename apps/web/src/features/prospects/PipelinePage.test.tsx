// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../app/auth';
import { queryClient } from '../../app/query';
import { useUiStore } from '../../app/store';
import { PipelinePage } from './PipelinePage';

const brand = { id: 1, name: 'Hana', code: 'HANA' };
const prospects = [
  { id: 1, brandId: 1, name: 'Deal Syawal', phone: '62811', status: 'deal', packageId: 10, package: { id: 10, name: 'Syawal' }, dealValue: 60_000_000, userId: 7, user: { id: 7, name: 'CS Fitri' }, leadSource: 'whatsapp', messages: [] },
  { id: 2, brandId: 1, name: 'Deal Ramadhan', phone: '62812', status: 'closed_won', packageId: 11, package: { id: 11, name: 'Ramadhan' }, dealValue: 50_000_000, userId: 7, user: { id: 7, name: 'CS Fitri' }, leadSource: 'whatsapp', messages: [] },
  { id: 3, brandId: 1, name: '62813', phone: '62813', status: 'new', packageId: null, dealValue: 0, userId: null, user: null, leadSource: 'whatsapp', messages: [{ timestamp: Math.floor(Date.now() / 1000) - 600, isFromMe: false }] },
];

function json(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as Response);
}

function renderAs(role: string, url = '/pipeline') {
  const user = { id: 9, name: 'Tester', email: 't@x.id', role, brandId: 1, brand, userBrands: [] };
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes('/auth/refresh')) return json({ accessToken: 't', user });
    if (u.includes('/prospects')) return json(prospects);
    if (u.includes('/catalog/packages')) return json([{ id: 10, name: 'Syawal' }, { id: 11, name: 'Ramadhan' }]);
    return json([]);
  }));
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <AuthProvider><PipelinePage /></AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient.clear();
  useUiStore.setState({ activeBrandId: 1 });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Pipeline', () => {
  it('menggabungkan chip cepat dengan filter paket (AND), dari URL', async () => {
    renderAs('admin', '/pipeline?view=table&quick=won&paket=10');
    expect(await screen.findByText('Deal Syawal')).toBeTruthy();
    expect(screen.queryByText('Deal Ramadhan')).toBeNull();
    // Jumlah di chip Deal mengikuti filter paket yang aktif.
    const dealChip = screen.getByRole('button', { name: /^Deal\s*1$/ });
    expect(dealChip.getAttribute('aria-pressed')).toBe('true');
  });

  it('klaim hanya untuk CS; admin mendapat "Tugaskan PIC"', async () => {
    renderAs('admin', '/pipeline?view=table');
    await screen.findByText('Deal Syawal');
    expect(screen.queryByRole('button', { name: /Klaim/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /Tugaskan PIC/ }).length).toBeGreaterThan(0);
    cleanup();
    queryClient.clear();
    renderAs('cs', '/pipeline?view=table');
    await screen.findByText('Deal Syawal');
    expect(screen.getAllByRole('button', { name: /Klaim/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Tugaskan PIC/ })).toBeNull();
  });

  it('kartu: tidak menampilkan nomor dua kali, "Belum ada penawaran" alih-alih Rp 0, dan sinyal menunggu balasan', async () => {
    renderAs('cs');
    const card = await screen.findByRole('article', { name: 'Kartu prospek 62813' });
    expect(within(card).queryByText(/Rp 0/)).toBeNull();
    expect(within(card).getByText('Belum ada penawaran')).toBeTruthy();
    expect(within(card).getByText(/^Menunggu balasan · 10 mnt$/)).toBeTruthy();
    expect(within(card).getAllByText(/62813/)).toHaveLength(1);
    // Aksi utama selalu ada di DOM dan berlabel (tidak bergantung hover).
    expect(within(card).getByRole('link', { name: 'Buka chat 62813' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Catat follow-up 62813' })).toBeTruthy();
  });
});

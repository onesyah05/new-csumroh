// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';

const auth = vi.hoisted(() => ({ user: { id: 1, role: 'admin' as string, brandId: null as number | null } }));
vi.mock('../../app/auth', () => ({ useAuth: () => auth }));

import { ReportsPage, periodRange } from './ReportsPage';

/** Rentang tanggal permintaan laporan terakhir untuk tab itu. */
const lastRange = (urls: string[], tab: string) => {
  const url = [...urls].reverse().find((u) => u.includes(`/reports/${tab}?`))!;
  return { from: /from=([\d-]+)/.exec(url)![1]!, to: /to=([\d-]+)/.exec(url)![1]! };
};

const sales = {
  summary: { leads: 20, deals: 4, jamaah: 11, lost: 3, conversion: 20, dealValue: 160_000_000, cashIn: 40_000_000, avgDealValue: 40_000_000, avgDaysToDeal: 6.5 },
  stages: [{ key: 'new', label: 'Baru', count: 13 }, { key: 'deal', label: 'Deal', count: 4 }, { key: 'lose', label: 'Batal', count: 3 }],
  byPackage: [{ label: 'Umroh Syawal', deals: 4, value: 160_000_000 }],
  byBrand: [{ label: 'Hana Tours', deals: 4, value: 160_000_000 }],
};
const deals = {
  basis: 'verified', summary: { deals: 1, dealValue: 33_999_000, daysToDeal: { avg: 8, median: 8, min: 8, max: 8 } },
  rows: [{ id: 9, brandId: 2, brand: 'Hana Tours', name: 'HaikalShahab', phone: '62812', packageName: 'Umroh Reguler', dealValue: 33_999_000, source: 'Meta Ads', adName: 'H078', pic: 'Nadiya', lastCs: { name: 'Dara', at: '2026-10-06T05:00:00.000Z' }, leadAt: '2026-09-28T05:00:00.000Z', verifiedAt: '2026-10-06T04:00:00.000Z', daysToDeal: 8 }],
};
const cs = { rows: [{ id: 7, name: 'Aisyah', isActive: true, leads: 10, deals: 2, dealValue: 80_000_000, conversion: 20, medianReplyMinutes: 12, takenOver: 1, openNow: 6, overdueFollowups: 2 }] };

const leads = {
  brandId: 2,
  totals: { newLeads: 4, oldLeads: 7 },
  rows: [
    { key: 'user:7', userId: 7, name: 'Aisyah', isActive: true, newLeads: 3, oldLeads: 5, medianReplyMinutes: 4 },
    { key: 'hp', userId: null, name: 'Dari HP (tanpa nama)', isActive: true, newLeads: 1, oldLeads: 2, medianReplyMinutes: null },
  ],
};

const creatives = {
  brands: [{ brandId: 2, brand: 'Hana Tours', status: 'error', message: 'Token belum punya izin ads_read untuk ad account ini.' }],
  rows: [{
    adId: 'A1', brand: 'Hana Tours', adName: 'Video testimoni jamaah', campaignName: 'Ramadan', thumbnailUrl: '/uploads/ad-creatives/A1.jpg',
    spend: 2_000_000, impressions: 50_000, clicks: 900, ctr: 1.8, conversations: 40, leads: 30, spam: 10, spamRate: 25, qualified: 12,
    deals: 1, dealValue: 40_000_000, costPerLead: 66_667, costPerQualified: 166_667, costPerDeal: 2_000_000, roas: 20,
  }],
};

let budgetResponse: () => Promise<Response> = () => json({ adSpend: 12_500_000, adSpendNote: null });

function json(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }), blob: async () => new Blob() } as Response);
}

describe('Menu Laporan', () => {
  let urls: string[] = [];
  beforeEach(() => {
    queryClient.clear();
    auth.user = { id: 1, role: 'admin', brandId: null };
    budgetResponse = () => json({ adSpend: 12_500_000, adSpendNote: null });
    urls = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/reports/sales/budget')) return budgetResponse();
      if (url.includes('/reports/sales')) return json(sales);
      if (url.includes('/reports/deals')) return json(url.includes('basis=lead') ? { basis: 'lead', summary: { deals: 0, dealValue: 0 }, rows: [] } : deals);
      if (url.includes('/reports/cs')) return json(cs);
      if (url.includes('/reports/leads')) return json(leads);
      if (url.includes('/reports/creatives')) return json(creatives);
      if (url.includes('/catalog/brands')) return json([{ id: 2, name: 'Hana Tours' }]);
      return json({});
    }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('preset periode memakai tanggal bisnis', () => {
    expect(periodRange('this_month', '2026-03-15')).toEqual({ from: '2026-03-01', to: '2026-03-15' });
    expect(periodRange('last_month', '2026-03-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('7d', '2026-03-03')).toEqual({ from: '2026-02-25', to: '2026-03-03' });
  });

  it('Penjualan tampil default untuk bulan ini; tab Kinerja CS memuat laporan per CS', async () => {
    render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/laporan']}><ReportsPage /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText('Lead baru')).toBeTruthy();
    expect(screen.getByText('Umroh Syawal')).toBeTruthy();
    // Kartu: Total budget, Lead baru, Deal (jumlah deal dan jamaah), Nilai deal; Uang masuk ada di tab Pembayaran.
    expect(screen.getByText('Total budget')).toBeTruthy();
    expect(await screen.findByText(/12.500.000/)).toBeTruthy();
    expect(screen.getByText('jamaah').parentElement?.textContent).toBe('4deal·11jamaah');
    expect(screen.getAllByText('Nilai deal').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/160.000.000/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Uang masuk')).toBeNull();
    expect(urls.find((u) => u.includes('/reports/sales'))).toMatch(/from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}&brandId=all/);

    fireEvent.click(screen.getByRole('tab', { name: 'Kinerja CS' }));
    expect(await screen.findByText('Aisyah')).toBeTruthy();
    expect(screen.getByText('12 menit')).toBeTruthy();
    await waitFor(() => expect(urls.some((u) => u.includes('/reports/cs?'))).toBe(true));
  });

  it('tab Lead Harian: default hari ini, pie lead baru dan lama, baris Dari HP di tabel', async () => {
    render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/laporan?tab=leads']}><ReportsPage /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText('Lead baru ditangani · 4')).toBeTruthy();
    expect(screen.getByText('Lead lama ditangani · 7')).toBeTruthy();
    expect(screen.getAllByText('Dari HP (tanpa nama)').length).toBe(3);
    expect(screen.getByText('4 menit')).toBeTruthy();
    // Arahkan ke irisan: tooltip nama, jumlah, dan persen; label tengah ikut berganti.
    const slice = document.querySelector('circle[stroke="#0f766e"]')!;
    fireEvent.pointerEnter(slice, { pointerType: 'mouse', clientX: 10, clientY: 10 });
    expect(screen.getByRole('tooltip').textContent).toBe('Aisyah3 nomor · 75%');
    fireEvent.pointerLeave(slice, { pointerType: 'mouse' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    const today = urls.find((u) => u.includes('/reports/leads?'))!;
    const from = /from=([\d-]+)/.exec(today)![1];
    expect(today).toContain(`to=${from}`);
  });

  it('pindah ke tab Lead Harian memakai "Hari ini"; kembali ke tab lain memakai "Bulan ini"', async () => {
    render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/laporan']}><ReportsPage /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText('Umroh Syawal')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Lead Harian' }));
    await waitFor(() => expect(urls.some((u) => u.includes('/reports/leads?'))).toBe(true));
    const day = lastRange(urls, 'leads');
    expect(day.from).toBe(day.to);
    fireEvent.click(screen.getByRole('tab', { name: 'Kinerja CS' }));
    await waitFor(() => expect(urls.some((u) => u.includes('/reports/cs?'))).toBe(true));
    expect(lastRange(urls, 'cs').from).toMatch(/-01$/);
  });

  it('CS: brand yang tampil di pilihan = brand yang dipilih API untuk datanya', async () => {
    auth.user = { id: 7, role: 'cs', brandId: 2 };
    render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/laporan']}><ReportsPage /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText('Lead baru ditangani · 4')).toBeTruthy();
    // Permintaan tanpa brand tertentu; API memakai brand bawaan CS lalu mengembalikannya (brandId 2).
    expect(urls.find((u) => u.includes('/reports/leads?'))).toContain('brandId=all');
    expect(screen.getAllByRole('combobox', { name: 'Cakupan brand' })[0]!.textContent).toContain('Hana Tours');
    expect(screen.queryByRole('tab', { name: 'Kinerja CS' })).toBeNull();
    expect(screen.queryByText('Unduh CSV')).toBeNull();
  });

  it('Total budget dimuat terpisah: Meta gagal tidak menahan kartu lain dan tampil sebagai gagal, bukan nol', async () => {
    budgetResponse = () => Promise.resolve({ ok: false, status: 502, json: async () => ({ success: false, error: 'Meta tidak merespons' }) } as Response);
    render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/laporan']}><ReportsPage /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText('Lead baru')).toBeTruthy();
    expect(await screen.findByText('Gagal mengambil dari Meta')).toBeTruthy();
    expect(screen.queryByText(/Rp 0/)).toBeNull();
    expect(urls.some((u) => /\/reports\/sales\/budget\?from=/.test(u))).toBe(true);
  });

  it('Total budget: catatan brand yang belum diatur ditampilkan', async () => {
    budgetResponse = () => json({ adSpend: 4_000_000, adSpendNote: 'Belum termasuk 1 brand belum diatur ad account' });
    render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/laporan']}><ReportsPage /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText('Belum termasuk 1 brand belum diatur ad account')).toBeTruthy();
  });

  it('Daftar deal di Penjualan: PIC, CS terakhir, dan pilihan tanggal verifikasi atau lead masuk', async () => {
    render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/laporan']}><ReportsPage /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText('HaikalShahab')).toBeTruthy();
    expect(screen.getByText('Nadiya')).toBeTruthy();
    expect(screen.getByText('Dara')).toBeTruthy();
    expect(screen.getByText('Rata-rata lead → deal')).toBeTruthy();
    expect(screen.getAllByText('8 hari').length).toBe(4);
    expect(urls.some((u) => u.includes('/reports/deals?') && u.includes('basis=verified'))).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Tanggal lead masuk' }));
    expect(await screen.findByText('Belum ada deal pada periode ini.')).toBeTruthy();
    expect(urls.some((u) => u.includes('basis=lead'))).toBe(true);
  });

  it('tab Kreatif iklan: thumbnail, metrik Meta, hasil CRM sampai ROAS, dan peringatan token', async () => {
    render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/laporan?tab=creatives']}><ReportsPage /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText('Video testimoni jamaah')).toBeTruthy();
    expect(screen.getByText('20×')).toBeTruthy();
    expect(screen.getByText('Winning')).toBeTruthy();
    expect(screen.getByText(/Token belum punya izin ads_read/)).toBeTruthy();
    expect(document.querySelector('img')?.getAttribute('src')).toContain('/uploads/ad-creatives/A1.jpg');
  });
});

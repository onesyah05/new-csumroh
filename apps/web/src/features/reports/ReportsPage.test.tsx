// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { ReportsPage, periodRange } from './ReportsPage';

const sales = {
  summary: { leads: 20, deals: 4, lost: 3, conversion: 20, dealValue: 160_000_000, cashIn: 40_000_000, avgDealValue: 40_000_000, avgDaysToDeal: 6.5 },
  stages: [{ key: 'new', label: 'Baru', count: 13 }, { key: 'deal', label: 'Deal', count: 4 }, { key: 'lose', label: 'Batal', count: 3 }],
  byPackage: [{ label: 'Umroh Syawal', deals: 4, value: 160_000_000 }],
  byBrand: [{ label: 'Hana Tours', deals: 4, value: 160_000_000 }],
};
const cs = { rows: [{ id: 7, name: 'Aisyah', isActive: true, leads: 10, deals: 2, dealValue: 80_000_000, conversion: 20, medianReplyMinutes: 12, takenOver: 1, openNow: 6, overdueFollowups: 2 }] };

const creatives = {
  brands: [{ brandId: 2, brand: 'Hana Tours', status: 'error', message: 'Token belum punya izin ads_read untuk ad account ini.' }],
  rows: [{
    adId: 'A1', brand: 'Hana Tours', adName: 'Video testimoni jamaah', campaignName: 'Ramadan', thumbnailUrl: '/uploads/ad-creatives/A1.jpg',
    spend: 2_000_000, impressions: 50_000, clicks: 900, ctr: 1.8, conversations: 40, leads: 30, spam: 10, spamRate: 25, qualified: 12,
    deals: 1, dealValue: 40_000_000, costPerLead: 66_667, costPerQualified: 166_667, costPerDeal: 2_000_000, roas: 20,
  }],
};

function json(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }), blob: async () => new Blob() } as Response);
}

describe('Menu Laporan', () => {
  let urls: string[] = [];
  beforeEach(() => {
    queryClient.clear();
    urls = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/reports/sales')) return json(sales);
      if (url.includes('/reports/cs')) return json(cs);
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
    expect(urls.find((u) => u.includes('/reports/sales'))).toMatch(/from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}&brandId=all/);

    fireEvent.click(screen.getByRole('tab', { name: 'Kinerja CS' }));
    expect(await screen.findByText('Aisyah')).toBeTruthy();
    expect(screen.getByText('12 menit')).toBeTruthy();
    await waitFor(() => expect(urls.some((u) => u.includes('/reports/cs?'))).toBe(true));
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

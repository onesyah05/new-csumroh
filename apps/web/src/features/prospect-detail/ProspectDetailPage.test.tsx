// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { ProspectDetailPage } from './ProspectDetailPage';

const auth = vi.hoisted(() => ({ user: { id: 7, name: 'Malik', role: 'cs', brandId: 1 } as Record<string, any> }));
vi.mock('../../app/auth', () => ({ useAuth: () => ({ user: auth.user }) }));

const customDeal = {
  id: 685, brandId: 1, name: 'Abu Syahid', phone: '6289612779919', status: 'deal', leadSource: 'whatsapp', userId: 7, user: { id: 7, name: 'Malik' },
  brand: { id: 1, name: 'Hana Tours' }, packageId: null, package: null, dealValue: '92000000', offerSentAt: '2026-09-26T05:00:00.000Z',
  invoiceSentAt: '2026-09-26T05:10:00.000Z', invoiceNumber: 'INV/202609/0685', invoiceAmount: '20000000', invoiceDueAt: '2026-09-26T05:10:00.000Z',
  targetMonth: '2027-02', paxQuad: 2, paxTriple: 0, paxDouble: 0, paxInfant: 0, budgetRange: '', passportStatus: '', nextFollowupDate: '2026-09-25T00:00:00.000Z',
  customRequests: [{ id: 3, status: 'agreed', mode: 'full', agreedPrice: '92000000', departureDate: '2027-02-10', departureDateTo: null, basePackage: null, quoteValidUntil: null }],
  payments: [{ id: 1, amount: '20000000', bankName: 'BSI', referenceNo: null, mutationDate: '2026-09-26', status: 'verified', correctedAt: null, reversalReason: null, createdAt: '2026-09-26T06:00:00.000Z' }],
  proofRejections: [],
};
let current: Record<string, any> = customDeal;

function json(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as Response);
}
const renderAt = (url = '/prospects/685') => render(
  <QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={[url]}><Routes><Route path="/prospects/:id" element={<ProspectDetailPage />} /></Routes></MemoryRouter>
  </QueryClientProvider>,
);

describe('Profil prospek', () => {
  beforeEach(() => {
    queryClient.clear();
    current = customDeal;
    auth.user = { id: 7, name: 'Malik', role: 'cs', brandId: 1 };
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/catalog/packages')) return json([]);
      if (url.includes('/logs')) return json({ logs: [], legacyNote: null });
      if (/\/prospects\/\d+/.test(url)) return json(current);
      return json({});
    }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('Deal layanan custom: nilai & booking dari custom, bukan "Pilih paket"; follow-up lampau tidak tampil', async () => {
    renderAt();
    expect(await screen.findByText('Layanan custom')).toBeTruthy();
    expect(screen.queryByText(/Pilih paket/)).toBeNull();
    expect(screen.getByText('Nilai deal')).toBeTruthy();
    expect(screen.getAllByText('Rp 92.000.000').length).toBeGreaterThan(0);
    expect(screen.getByText('Full custom · Rp 92.000.000 disepakati')).toBeTruthy();
    expect(screen.getByText('INV/202609/0685')).toBeTruthy();
    expect(screen.getByText('10 Feb 2027')).toBeTruthy();
    expect(screen.getByText('Deal · penanganan CS selesai')).toBeTruthy();
    expect(screen.getByText(/WhatsApp · PIC Malik/)).toBeTruthy();
  });

  it('Finance hanya membaca: isian kualifikasi dikunci dengan keterangan', async () => {
    auth.user = { id: 3, name: 'Fina', role: 'finance' };
    current = { ...customDeal, status: 'closing', customRequests: [], packageId: null };
    renderAt();
    await screen.findByText('Kualifikasi');
    const quad = screen.getByLabelText(/Quad/i) as HTMLInputElement;
    expect(quad.disabled).toBe(true);
    expect((screen.getByLabelText('Kebutuhan khusus') as HTMLInputElement).disabled).toBe(true);
  });

  it('prospek batal menampilkan alasan; spam dan sumber iklan tampil di header; tab mengikuti URL', async () => {
    current = { ...customDeal, status: 'lose', lostReason: 'Harga terlalu tinggi', spamAt: '2026-09-26T00:00:00.000Z', leadSource: 'meta_ads', adHeadline: 'Umroh Ramadan', customRequests: [] };
    renderAt('/prospects/685?tab=activity');
    expect(await screen.findByText('Batal · Harga terlalu tinggi')).toBeTruthy();
    expect(screen.getByText('Spam')).toBeTruthy();
    expect(screen.getByText(/Meta Ads · Umroh Ramadan/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Catatan & riwayat' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'Profil' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Profil' }).getAttribute('aria-selected')).toBe('true'));
  });
});

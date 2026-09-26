// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { VerificationPage } from './VerificationPage';
import { Toaster } from '../../app/toast';

const auth = vi.hoisted(() => ({ role: 'finance' }));
vi.mock('../../app/auth', () => ({ useAuth: () => ({ user: { id: 1, name: 'Fina', role: auth.role } }) }));

const brand = { id: 2, name: 'Hana Tours', code: 'HANA' };
const base = {
  brandId: 2, phone: '62811', paymentStatus: 'unpaid', dealValue: 60_000_000, dpAmount: 0, invoiceAmount: 10_000_000,
  invoiceNumber: 'INV/202609/0001', invoiceSentAt: '2026-09-20T03:00:00.000Z', package: { id: 1, name: 'Umroh Syawal' },
  user: { id: 7, name: 'CS Aisyah' }, brand,
};
const history = {
  items: [
    {
      key: 'p5', type: 'payment', id: 5, status: 'verified', at: '2026-09-24T03:00:00.000Z', brand,
      prospect: { id: 5, name: 'Bu Rahma', phone: '0812', invoiceNumber: 'INV/5', paymentStatus: 'partial_dp', status: 'deal' },
      amount: 15_000_000, paymentType: 'dp', bankName: 'Bank Syariah Indonesia (BSI)', referenceNo: 'FT123', mutationDate: '2026-09-24T00:00:00.000Z',
      notes: null, proofUrl: null, actor: 'Fina', reason: null, correctedAt: null, reversedAt: null, reversedBy: null,
    },
    {
      key: 'r2', type: 'rejection', id: 2, status: 'rejected', at: '2026-09-23T03:00:00.000Z', brand,
      prospect: { id: 6, name: 'Pak Umar', phone: null, invoiceNumber: null, paymentStatus: 'unpaid', status: 'closing' },
      amount: null, paymentType: null, bankName: null, referenceNo: null, mutationDate: null, notes: null, proofUrl: null,
      actor: 'Fina', reason: 'Nominal tidak sesuai tagihan', correctedAt: null, reversedAt: null, reversedBy: null,
    },
  ],
  page: 1, pageSize: 50, total: 2,
  totals: { verifiedCount: 1, verifiedAmount: 15_000_000, rejectedCount: 1, reversedCount: 0, byBank: [{ bankName: 'Bank Syariah Indonesia (BSI)', count: 1, amount: 15_000_000 }] },
};
const queue = {
  submitted: [{ ...base, id: 1, name: 'Ibu Siti', status: 'closing', paymentProofUrl: '/api/v1/prospects/payment-proof-file/proof-1-1-ab.jpg', paymentProofMessageId: 'M1', paymentProofSubmittedAt: '2026-09-23T01:00:00.000Z' }],
  candidates: [{
    ...base, id: 2, name: 'Pak Ahmad', status: 'closing', dpAmount: 10_000_000, paymentStatus: 'partial_dp',
    candidateMessages: [{ id: 99, messageId: 'M99', messageType: 'imageMessage', mediaUrl: '/uploads/media/tf.jpg', timestamp: 1_790_000_000 }],
  }],
};

function json(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }), blob: async () => new Blob() } as Response);
}

describe('Menu Verifikasi Pembayaran', () => {
  let calls: { url: string; init?: RequestInit }[] = [];

  beforeEach(() => {
    auth.role = 'finance';
    queryClient.clear();
    calls = [];
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:proof', revokeObjectURL: () => undefined }));
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('/verification/queue')) return json(queue);
      if (url.includes('/verification/summary')) return json({ verifiedToday: 3, verifiedAmountToday: 45_000_000, rejectedToday: 1, avgVerifyMinutes: 95 });
      if (url.includes('/verification/history')) return json(history);
      if (url.includes('/catalog/brands')) return json([brand]);
      return json({});
    }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('menampilkan bukti yang diajukan lintas brand; kandidat dari chat tidak lagi tampil', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><VerificationPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Ibu Siti')).toBeTruthy();
    expect(screen.queryByText('Pak Ahmad')).toBeNull();
    expect(screen.queryByText(/Kandidat bukti/)).toBeNull();
    expect(screen.getByRole('tab', { name: 'Antrean (1)' })).toBeTruthy();
    expect(screen.queryByText(/Sisa .* dari /)).toBeNull();
    expect(screen.queryByText(/Pelunasan ·/)).toBeNull();
    expect(calls.some((c) => c.url.includes('/verification/queue?brandId=all'))).toBe(true);
  });

  it('Finance menolak bukti dengan alasan; tombol aktif setelah alasan diisi', async () => {
    // Umpan balik tampil lewat toast global aplikasi (Toaster dipasang di App).
    render(<QueryClientProvider client={queryClient}><MemoryRouter><VerificationPage /><Toaster /></MemoryRouter></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Tolak bukti Ibu Siti' }));
    expect(await screen.findByRole('dialog', { name: 'Tolak bukti transfer' })).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Tolak bukti' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Rekening tujuan salah' }));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => {
      const call = calls.find((c) => c.url.includes('/prospects/1/reject-proof'));
      expect(call && JSON.parse(String(call.init?.body))).toEqual({ reason: 'Rekening tujuan salah', brandId: 2 });
    });
    expect(await screen.findByText('Bukti transfer Ibu Siti ditolak. PIC sudah diberi tahu.')).toBeTruthy();
  });

  const renderPage = () => render(<QueryClientProvider client={queryClient}><MemoryRouter><VerificationPage /><Toaster /></MemoryRouter></QueryClientProvider>);

  it('ringkasan harian untuk manajemen dan penanda umur bukti', async () => {
    renderPage();
    expect(await screen.findByText('Diverifikasi hari ini')).toBeTruthy();
    expect(await screen.findByText('Rp 45.000.000', { exact: false })).toBeTruthy();
    expect(screen.getByText('2 jam')).toBeTruthy();
    // Bukti Ibu Siti diajukan berhari-hari lalu: waktu tunggu tampil sebagai terlambat.
    expect((await screen.findByText(/Dari chat · \d+ hari lalu/)).className).toContain('rose');
    expect(screen.getByRole('link', { name: 'Ibu Siti' }).getAttribute('href')).toBe('/prospects/1');
  });

  it('cari di antrean menyaring nama/invoice', async () => {
    renderPage();
    await screen.findByText('Ibu Siti');
    fireEvent.change(screen.getByPlaceholderText('Cari nama, telepon, no. invoice, PIC'), { target: { value: 'ahmad' } });
    expect(screen.queryByText('Ibu Siti')).toBeNull();
  });

  it('tab Riwayat: terverifikasi & ditolak, total per bank, tanpa aksi koreksi untuk Finance', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Riwayat' }));
    expect(await screen.findByText('Bu Rahma')).toBeTruthy();
    expect(screen.getByText('Nominal tidak sesuai tagihan')).toBeTruthy();
    expect(screen.getByText(/Bank Syariah Indonesia \(BSI\): Rp/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Koreksi pembayaran/ })).toBeNull();
    const url = calls.find((c) => c.url.includes('/verification/history'))!.url;
    expect(url).toContain('status=all');
    expect(url).toMatch(/from=\d{4}-\d{2}-01/);
  });

  it('Superadmin membatalkan verifikasi dengan alasan wajib', async () => {
    auth.role = 'superadmin';
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Riwayat' }));
    expect(await screen.findByRole('button', { name: 'Koreksi pembayaran Bu Rahma' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Batalkan verifikasi Bu Rahma' }));
    const confirm = await screen.findByRole('button', { name: 'Batalkan verifikasi' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Alasan pembatalan'), { target: { value: 'Mutasi tidak ditemukan' } });
    fireEvent.click(confirm);
    await waitFor(() => {
      const call = calls.find((c) => c.url.endsWith('/verification/payments/5/reverse'));
      expect(call && JSON.parse(String(call.init?.body))).toEqual({ reason: 'Mutasi tidak ditemukan' });
    });
  });

  it('modal verifikasi: patokan, peringatan selisih invoice, dan DP minimal custom', async () => {
    queue.submitted[0] = { ...queue.submitted[0]!, customMinDp: 12_000_000, customAgreedPrice: 80_000_000 } as any;
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Verifikasi' }));
    const dialog = await screen.findByRole('dialog', { name: 'Verifikasi pembayaran' });
    expect(dialog.textContent).toMatch(/Nilai dealRp\s80\.000\.000/);
    expect(dialog.textContent).toContain('Bukti dari chat WhatsApp');
    const amount = screen.getByLabelText('Nominal diterima');
    const submit = screen.getByRole('button', { name: 'Verifikasi & tetapkan Deal' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('Di bawah DP minimal');
    fireEvent.change(amount, { target: { value: '12.500.000' } });
    expect(submit.disabled).toBe(false);
    expect(dialog.textContent).toMatch(/Lebih Rp\s2\.500\.000 dari tagihan invoice/);
    delete (queue.submitted[0] as any).customMinDp;
    delete (queue.submitted[0] as any).customAgreedPrice;
  });
});

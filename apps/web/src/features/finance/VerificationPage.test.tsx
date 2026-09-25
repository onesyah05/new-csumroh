// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { VerificationPage } from './VerificationPage';
import { Toaster } from '../../app/toast';

const brand = { id: 2, name: 'Hana Tours', code: 'HANA' };
const base = {
  brandId: 2, phone: '62811', paymentStatus: 'unpaid', dealValue: 60_000_000, dpAmount: 0, invoiceAmount: 10_000_000,
  invoiceNumber: 'INV/202609/0001', invoiceSentAt: '2026-09-20T03:00:00.000Z', package: { id: 1, name: 'Umroh Syawal' },
  user: { id: 7, name: 'CS Aisyah' }, brand,
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
    queryClient.clear();
    calls = [];
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:proof', revokeObjectURL: () => undefined }));
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('/verification/queue')) return json(queue);
      if (url.includes('/catalog/brands')) return json([brand]);
      return json({});
    }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows submitted proofs and chat candidates across brands, for initial payments only', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><VerificationPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Ibu Siti')).toBeTruthy();
    expect(screen.getByText('Pak Ahmad')).toBeTruthy();
    expect(screen.getAllByText(/Pembayaran awal ·/).length).toBe(2);
    expect(screen.queryByText(/Sisa .* dari /)).toBeNull();
    expect(screen.queryByText(/Pelunasan ·/)).toBeNull();
    expect(calls.some((c) => c.url.includes('/verification/queue?brandId=all'))).toBe(true);
  });

  it('turns a chat image into a proof with one click, without re-uploading the file', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><VerificationPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Jadikan bukti' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/prospects/2/payment-proof-from-message'))).toBe(true));
    const post = calls.find((c) => c.url.endsWith('/prospects/2/payment-proof-from-message'))!;
    expect(JSON.parse(String(post.init?.body))).toEqual({ messageId: 99, brandId: 2 });
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
});

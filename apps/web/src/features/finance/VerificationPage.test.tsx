// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { VerificationPage } from './VerificationPage';

const brand = { id: 2, name: 'Hana Tours', code: 'HANA' };
const base = {
  brandId: 2, phone: '62811', paymentStatus: 'unpaid', dealValue: 60_000_000, dpAmount: 0, invoiceAmount: 10_000_000,
  invoiceNumber: 'INV/202609/0001', invoiceSentAt: '2026-09-20T03:00:00.000Z', package: { id: 1, name: 'Umroh Syawal' },
  user: { id: 7, name: 'CS Aisyah' }, brand,
};
const queue = {
  submitted: [{ ...base, id: 1, name: 'Ibu Siti', status: 'closing', paymentProofUrl: '/api/v1/prospects/payment-proof-file/proof-1-1-ab.jpg', paymentProofMessageId: 'M1', paymentProofSubmittedAt: '2026-09-23T01:00:00.000Z' }],
  candidates: [{
    ...base, id: 2, name: 'Pak Ahmad', status: 'deal', dpAmount: 10_000_000, paymentStatus: 'partial_dp',
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

  it('shows submitted proofs and chat candidates across brands, including settlement bills', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><VerificationPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Ibu Siti')).toBeTruthy();
    expect(screen.getByText('Pak Ahmad')).toBeTruthy();
    expect(screen.getByText(/Pelunasan ·/)).toBeTruthy();
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
});

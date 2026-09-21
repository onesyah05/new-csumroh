// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { WhatsAppDevicePanel } from './WhatsAppDevicePanel';

function response(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as Response);
}

describe('WhatsAppDevicePanel', () => {
  beforeEach(() => {
    queryClient.clear();
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/whatsapp/status')) return response({
        brandId: 7,
        sessionName: 'brand_7',
        status: 'qr_ready',
        phoneNumber: null,
        qrCode: 'data:image/png;base64,cXItY29kZQ==',
        lastConnectedAt: null,
      });
      if (url.includes('/whatsapp/start') && init?.method === 'POST') return response({
        brandId: 7,
        sessionName: 'brand_7',
        status: 'connecting',
        phoneNumber: null,
        qrCode: null,
        lastConnectedAt: null,
      });
      return response(null);
    }));
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.unstubAllGlobals();
  });

  it('shows the selected brand QR and starts a new device session for that brand', async () => {
    render(<QueryClientProvider client={queryClient}><WhatsAppDevicePanel brandId={7} brandName="Azhan Travel" canManage /></QueryClientProvider>);

    expect(await screen.findByAltText('QR WhatsApp Azhan Travel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /buat qr baru/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/whatsapp/start'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ brandId: 7 }) }),
    ));
  });

  it('keeps device controls read-only for a brand admin', async () => {
    render(<QueryClientProvider client={queryClient}><WhatsAppDevicePanel brandId={7} brandName="Azhan Travel" canManage={false} /></QueryClientProvider>);

    expect(await screen.findByText(/akses pantau status saja/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /buat qr baru/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /putuskan perangkat/i })).toBeNull();
    expect(screen.getByRole('button', { name: /perbarui status/i })).toBeTruthy();
  });
});

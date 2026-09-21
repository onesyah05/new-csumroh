// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { AuthProvider } from './auth';
import { queryClient } from './query';

vi.mock('socket.io-client', () => ({
  io: () => ({ on: vi.fn(), close: vi.fn() }),
}));

const user = {
  id: 2,
  name: 'Admin Brand',
  email: 'admin@local.test',
  role: 'admin',
  brandId: 1,
  brand: { id: 1, name: 'Hana Tours & Travel', code: 'HANA' },
};

const conversation = {
  id: 11,
  name: 'Ibu Aisyah',
  phone: '628123456789',
  status: 'new',
  packageId: null,
  user: null,
  messages: [{ id: 1, messageText: 'Assalamualaikum', isFromMe: false, timestamp: 1_700_000_000 }],
};

const prospect = {
  id: 11,
  name: 'Ibu Aisyah',
  phone: '628123456789',
  city: 'Bandung',
  status: 'new',
  leadSource: 'whatsapp',
  dealValue: 0,
  nextFollowupDate: null,
  package: null,
  user: null,
};

function response(data: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data }),
  } as Response);
}

describe('workspace navigation', () => {
  beforeEach(() => {
    queryClient.clear();
    localStorage.clear();

    // Some browser extensions wrap this method and return an object. Effects must
    // still return void so React never treats that value as a cleanup function.
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(() => ({ animated: true })),
    });

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/auth/refresh')) return response({ accessToken: 'test-token', user });
      if (url.includes('/dashboard')) return response({ total: 1, won: 0, conversionRate: 0, unassigned: 1, pipeline: [], recent: [conversation], wa: null });
      if (url.includes('/chat/conversations')) return response([conversation]);
      if (url.includes('/chat/prospects/')) return response(conversation.messages);
      if (url.includes('/contacts')) return response([{ ...prospect, remoteJid: '628123456789@s.whatsapp.net', leadSource: 'whatsapp', messageCount: 1, messages: conversation.messages }]);
      if (url.includes('/scripts/lms')) return response({ stages: [{ id: 'stage-1', nama: 'Sapaan amanah', tujuan: 'Melayani jamaah dengan baik.' }] });
      if (url.includes('/scripts')) return response({ categories: { greeting: { scripts: [] }, identification: { scripts: [] }, offer: { scripts: [] }, objection: { scripts: [] }, followups: { scripts: [] }, closing: { scripts: [] } } });
      if (url.includes('/catalog/brands')) return response([{ id: 1, name: user.brand.name, code: user.brand.code, _count: { users: 1, packages: 0, prospects: 1 } }]);
      if (url.includes('/catalog/packages') || url.includes('/catalog/users')) return response([]);
      if (url.includes('/prospects/11')) return response(prospect);
      if (url.includes('/prospects')) return response([prospect]);
      return response(null);
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('moves across every primary menu without crashing during effect cleanup', async () => {
    render(
      <React.StrictMode>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/']}>
            <AuthProvider><App /></AuthProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </React.StrictMode>,
    );

    await screen.findByText('Aktivitas prospek terbaru');

    fireEvent.click(screen.getByRole('link', { name: /^kotak masuk$/i }));
    await screen.findByRole('heading', { name: 'Kotak masuk' });
    await screen.findAllByText('Assalamualaikum');
    fireEvent.click(screen.getByRole('button', { name: /^profil$/i }));
    await screen.findByRole('heading', { name: 'Profil jamaah' });
    await screen.findByText('Bandung');
    expect(screen.getByRole('link', { name: /buka editor profil lengkap/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('link', { name: /pipeline crm/i }));
    await screen.findByRole('heading', { name: 'Prospek jamaah' });

    const transferred = new Map<string,string>();
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type:string,value:string) => transferred.set(type,value),
      getData: (type:string) => transferred.get(type) ?? '',
    };
    fireEvent.dragStart(screen.getByRole('article', { name: 'Kartu prospek Ibu Aisyah' }), { dataTransfer });
    fireEvent.dragOver(screen.getByRole('region', { name: 'Kolom Deal menang' }), { dataTransfer });
    fireEvent.drop(screen.getByRole('region', { name: 'Kolom Deal menang' }), { dataTransfer });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/prospects/11/status'),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'closed_won' }) }),
    ));

    fireEvent.click(screen.getByRole('link', { name: /daftar kontak/i }));
    await screen.findByRole('heading', { name: 'Daftar kontak' });
    await screen.findByText('1 pesan tersimpan');
    expect(screen.getByRole('button', { name: /tambah kontak/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('link', { name: /copilot skrip/i }));
    await screen.findByRole('heading', { name: 'Copilot percakapan' });

    fireEvent.click(screen.getByRole('link', { name: /akademi cs/i }));
    await screen.findByRole('heading', { name: 'Sapaan amanah' });

    fireEvent.click(screen.getByRole('link', { name: /administrasi/i }));
    await screen.findByRole('heading', { name: 'Kelola operasional' });

    await waitFor(() => expect(screen.queryByText('Halaman gagal ditampilkan')).toBeNull());
  });
});

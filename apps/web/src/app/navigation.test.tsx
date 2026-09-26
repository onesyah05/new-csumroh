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
      if (url.includes('/dashboard/tasks')) return response({ role: 'manager', tasks: [], waiting: null });
      if (url.includes('/dashboard')) return response({
        scope: { isHoldingView: false, currentBrandId: 1, role: 'cs', brands: [{ id: 1, name: user.brand.name }] },
        period: { key: 'this_month', comparison: 'periode yang sama bulan lalu', from: '2026-08-31T17:00:00.000Z', to: '2026-09-24T03:00:00.000Z', prevFrom: '2026-07-31T17:00:00.000Z', prevTo: '2026-08-24T03:00:00.000Z' },
        kpis: { leads: { value: 1, previous: 0 }, deals: { value: 0, previous: 0, jamaah: 0 }, bookingValue: { value: 0, previous: 0 }, cashIn: { value: 0, previous: 0 }, receivables: { amount: 0, bookings: 0, withoutValue: 0 } },
        funnel: { stages: [{ label: 'Lead masuk', count: 1 }], lost: 0, conversion: 0, sources: [] },
        brands: [], team: null, departures: [],
      });
      if (url.includes('/chat/wa/status')) return response({ brandId: 1, status: 'connected', phoneNumber: '628123456789' });
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

    await screen.findByText(/perjalanan lead/i, undefined, { timeout: 8000 });

    fireEvent.click(screen.getByRole('link', { name: /^kotak masuk$/i }));
    await screen.findAllByText("Assalamualaikum", undefined, { timeout: 8000 });
    // Header chat: avatar + nama adalah tombol (keyboard) yang membuka/menutup panel Profil & Copilot.
    const profileToggle = screen.getByRole('button', { name: /^Ibu Aisyah/ });
    expect(profileToggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(profileToggle);
    expect(profileToggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(profileToggle);
    // Item daftar percakapan bisa difokus keyboard.
    expect(screen.getByRole('button', { name: 'Percakapan dengan Ibu Aisyah' }).getAttribute('tabindex')).toBe('0');

    fireEvent.click(screen.getByRole('link', { name: /^pipeline$/i }));
    await screen.findByRole('heading', { name: 'Pipeline' }, { timeout: 8000 });

    fireEvent.click(screen.getByRole('link', { name: /akademi cs/i }));
    await screen.findByRole('heading', { name: 'Sapaan amanah' }, { timeout: 8000 });

    fireEvent.click(screen.getByRole('link', { name: /^brand travel$/i }));
    await screen.findByRole('heading', { name: 'Brand Travel' }, { timeout: 8000 });

    // Perangkat WhatsApp & Meta CAPI kini tab di detail Brand, bukan menu sidebar.
    expect(screen.queryByRole('link', { name: /^perangkat whatsapp$/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /^meta capi$/i })).toBeNull();

    await waitFor(() => expect(screen.queryByText('Halaman gagal ditampilkan')).toBeNull());
  }, 30_000); // halaman dimuat lazy per route; run dingin perlu waktu transform lebih lama
});

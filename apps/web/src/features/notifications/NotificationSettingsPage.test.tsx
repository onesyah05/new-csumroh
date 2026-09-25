// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { useNotificationTitle } from './NotificationBell';
import { NotificationSettingsPage } from './NotificationSettingsPage';

const preferences = [
  { type: 'message.inbound', group: 'Lead & chat', label: 'Pesan baru dari jamaah', description: 'Pesan jamaah.', priority: 'info', toast: false, sound: false, locked: false },
  { type: 'pic.taken_over', group: 'PIC', label: 'Prospek saya diambil alih', description: 'Diambil alih.', priority: 'urgent', toast: true, sound: false, locked: true },
];

let calls: { url: string; init?: RequestInit }[] = [];
function json(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as Response);
}

beforeEach(() => {
  queryClient.clear();
  calls = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/unread-count')) return json({ actionable: 3, urgent: 0, info: 5 });
    if (url.includes('/notifications/preferences') && init?.method === 'PUT') {
      const [item] = JSON.parse(String(init.body)).items;
      return json(preferences.map((p) => (p.type === item.type ? { ...p, ...item } : p)));
    }
    if (url.includes('/notifications/preferences')) return json(preferences);
    return json(null);
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><NotificationSettingsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Pengaturan notifikasi', () => {
  it('dikelompokkan; notifikasi mendesak tidak bisa dimatikan', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Lead & chat' })).toBeTruthy();
    const urgentToast = screen.getByRole('switch', { name: 'Tampilkan toast: Prospek saya diambil alih' }) as HTMLButtonElement;
    expect(urgentToast.getAttribute('aria-checked')).toBe('true');
    expect(urgentToast.disabled).toBe(true);
  });

  it('mengubah toggle langsung menyimpan satu preferensi', async () => {
    renderPage();
    const toggle = await screen.findByRole('switch', { name: 'Tampilkan toast: Pesan baru dari jamaah' });
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Tampilkan toast: Pesan baru dari jamaah' }).getAttribute('aria-checked')).toBe('true'));
    await waitFor(() => {
      const put = calls.find((c) => c.init?.method === 'PUT');
      expect(put && JSON.parse(String(put.init?.body))).toEqual({ items: [{ type: 'message.inbound', toast: true, sound: false }] });
    });
  });
});

describe('Judul tab', () => {
  it('menampilkan jumlah notifikasi belum dibaca', async () => {
    document.title = 'CRM AZHAN';
    function Probe() { useNotificationTitle(); return null; }
    render(<QueryClientProvider client={queryClient}><Probe /></QueryClientProvider>);
    await waitFor(() => expect(document.title).toBe('(3) CRM AZHAN'));
  });
});

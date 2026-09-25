// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { pushNotificationToast, pushToast, resetNotificationBurst, Toaster, useToastStore } from '../../app/toast';
import { NotificationBell, openNotificationPanel } from './NotificationBell';

const now = new Date().toISOString();
let counts = { actionable: 1, urgent: 1, info: 0 };
const items = [
  { id: 2, type: 'pic.taken_over', priority: 'urgent', title: 'Ibu Aisyah diambil alih Rahma', body: 'Jamaah belum dibalas 18 menit.', link: '/prospects/7', count: 1, createdAt: now, updatedAt: now, readAt: null, resolvedAt: null },
  { id: 1, type: 'message.inbound', priority: 'info', title: 'Pesan baru dari Pak Budi', body: 'Assalamualaikum', link: '/inbox?prospectId=8', count: 3, createdAt: now, updatedAt: now, readAt: now, resolvedAt: null },
];

function json(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as Response);
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}{location.search}</p>;
}

function renderBell() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes><Route path="*" element={<><NotificationBell placement="header" /><Where /><Toaster /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient.clear();
  useToastStore.setState({ toasts: [] });
  resetNotificationBurst();
  counts = { actionable: 1, urgent: 1, info: 0 };
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/unread-count')) return json(counts);
    if (url.includes('/read')) return json({ unread: { total: 0, urgent: 0 } });
    if (url.includes('/notifications')) return json({ items, nextCursor: null });
    return json(null);
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Lonceng notifikasi', () => {
  it('menampilkan jumlah belum dibaca dan mendesak pada label tombol', async () => {
    renderBell();
    expect(await screen.findByRole('button', { name: 'Notifikasi, 1 perlu tindakan, 1 mendesak' })).toBeTruthy();
  });

  it('panel memuat daftar; klik item menandai dibaca dan membuka tautannya', async () => {
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: /^Notifikasi, 1/ }));
    expect(await screen.findByRole('dialog', { name: 'Notifikasi' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Perlu tindakan (1)' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(await screen.findByText('Ibu Aisyah diambil alih Rahma'));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/prospects/7'));
    const calls = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
    expect(calls.some((u) => u.includes('/notifications/2/read'))).toBe(true);
    expect(screen.queryByRole('dialog', { name: 'Notifikasi' })).toBeNull();
  });

  it('panel dirender di <body> (portal), bukan di dalam sidebar yang memotongnya', async () => {
    renderBell();
    const bell = await screen.findByRole('button', { name: /^Notifikasi, 1/ });
    fireEvent.click(bell);
    const panel = await screen.findByRole('dialog', { name: 'Notifikasi' });
    expect(panel.parentElement).toBe(document.body);
    expect(bell.parentElement?.contains(panel)).toBe(false);
  });

  it('Escape menutup panel dan mengembalikan fokus ke lonceng', async () => {
    renderBell();
    const bell = await screen.findByRole('button', { name: /^Notifikasi, 1/ });
    fireEvent.click(bell);
    await screen.findByRole('dialog', { name: 'Notifikasi' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Notifikasi' })).toBeNull();
    expect(document.activeElement).toBe(bell);
  });
});

describe('Toast global', () => {
  it('mendesak tetap tampil; tindakan hilang sendiri setelah beberapa detik', () => {
    vi.useFakeTimers();
    renderBell();
    act(() => {
      pushToast({ id: 'a', title: 'WhatsApp Hana terputus', priority: 'urgent' });
      pushToast({ id: 'b', title: 'Lead baru: Ibu Aisyah', priority: 'action' });
    });
    expect(screen.getByRole('alert').textContent).toContain('WhatsApp Hana terputus');
    act(() => { vi.advanceTimersByTime(7000); });
    expect(screen.queryByText('Lead baru: Ibu Aisyah')).toBeNull();
    expect(screen.getByText('WhatsApp Hana terputus')).toBeTruthy();
  });
});

describe('Lencana dan panel (puluhan notifikasi)', () => {
  it('hanya info: titik tanpa angka', async () => {
    counts = { actionable: 0, urgent: 0, info: 12 };
    renderBell();
    const bell = await screen.findByRole('button', { name: 'Notifikasi, ada info baru' });
    expect(bell.querySelector('[data-testid="notification-info-dot"]')).toBeTruthy();
    expect(bell.textContent).not.toContain('12');
  });

  it('tab Semua dikelompokkan per hari; tombol cepat menandai dibaca tanpa membuka halaman', async () => {
    counts = { actionable: 0, urgent: 0, info: 1 };
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: /^Notifikasi/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Semua' }));
    expect(await screen.findByRole('region', { name: 'Hari ini' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tandai dibaca: Ibu Aisyah diambil alih Rahma' }));
    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
      expect(calls.some((u) => u.includes('/notifications/2/read'))).toBe(true);
    });
    expect(screen.getByTestId('where').textContent).toBe('/');
    expect(screen.getByRole('dialog', { name: 'Notifikasi' })).toBeTruthy();
  });

  it('tab Perlu tindakan dikelompokkan Mendesak dulu', async () => {
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: /^Notifikasi, 1/ }));
    const groups = await screen.findAllByRole('region');
    expect(groups[0]?.getAttribute('aria-label')).toBe('Mendesak');
  });

  it('openNotificationPanel membuka panel lonceng yang terlihat', async () => {
    renderBell();
    const bell = await screen.findByRole('button', { name: /^Notifikasi, 1/ });
    // happy-dom tidak menghitung tata letak: anggap tombol terlihat.
    bell.getClientRects = () => [{} as DOMRect] as unknown as DOMRectList;
    act(() => openNotificationPanel());
    expect(await screen.findByRole('dialog', { name: 'Notifikasi' })).toBeTruthy();
  });
});

describe('Rem banjir toast', () => {
  it('3 notifikasi tampil satu per satu; ke-4 dalam 5 detik diganti satu ringkasan yang membuka panel', () => {
    renderBell();
    const openPanel = vi.fn();
    const at = 1_000_000;
    act(() => {
      for (let i = 1; i <= 3; i++) pushNotificationToast({ id: i, title: `N${i}`, priority: i === 1 ? 'urgent' : 'action' }, openPanel, at + i);
    });
    expect(useToastStore.getState().toasts.map((t) => t.id)).toEqual(['notification-1', 'notification-2', 'notification-3']);
    act(() => { pushNotificationToast({ id: 4, title: 'N4', priority: 'action' }, openPanel, at + 10); });
    act(() => { pushNotificationToast({ id: 5, title: 'N5', priority: 'urgent' }, openPanel, at + 20); });
    const toasts = useToastStore.getState().toasts;
    expect(toasts.map((t) => t.id)).toEqual(['notification-burst']);
    expect(toasts[0]).toMatchObject({ title: '5 notifikasi baru', priority: 'urgent' });
    expect(toasts[0]?.body).toContain('2 mendesak');
    fireEvent.click(screen.getByRole('button', { name: '5 notifikasi baru' }));
    expect(openPanel).toHaveBeenCalled();
  });
});

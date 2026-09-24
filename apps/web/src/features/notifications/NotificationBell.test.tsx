// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { pushToast, Toaster, useToastStore } from '../../app/toast';
import { NotificationBell } from './NotificationBell';

const now = new Date().toISOString();
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
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/unread-count')) return json({ total: 1, urgent: 1 });
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
    expect(await screen.findByRole('button', { name: 'Notifikasi, 1 belum dibaca, 1 mendesak' })).toBeTruthy();
  });

  it('panel memuat daftar; klik item menandai dibaca dan membuka tautannya', async () => {
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: /^Notifikasi, 1/ }));
    expect(await screen.findByRole('dialog', { name: 'Notifikasi' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Perlu tindakan' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(await screen.findByText('Ibu Aisyah diambil alih Rahma'));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/prospects/7'));
    const calls = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
    expect(calls.some((u) => u.includes('/notifications/2/read'))).toBe(true);
    expect(screen.queryByRole('dialog', { name: 'Notifikasi' })).toBeNull();
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

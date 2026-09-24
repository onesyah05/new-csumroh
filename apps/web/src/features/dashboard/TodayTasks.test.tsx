// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { TodayTasks } from './TodayTasks';

function json(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as Response);
}

function renderWith(data: unknown) {
  vi.stubGlobal('fetch', vi.fn(() => json(data)));
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><TodayTasks scope="?brandId=1" /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => queryClient.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Perlu dikerjakan sekarang', () => {
  it('mendesak tampil lebih dulu, dengan tautan ke tampilan terfilter; daftar jamaah menunggu', async () => {
    renderWith({
      role: 'cs',
      tasks: [
        { key: 'followup_today', label: 'Follow-up hari ini', count: 0, hint: null, link: '/pipeline?quick=today&pic=mine', tone: 'clear' },
        { key: 'reply', label: 'Jamaah menunggu balasan', count: 2, hint: 'Terlama 12 menit', link: '/pipeline?quick=reply&pic=mine', tone: 'urgent' },
      ],
      waiting: { title: 'Jamaah saya yang menunggu balasan', items: [{ id: 5, brandId: 1, brandName: null, name: 'Ibu Aisyah', waitedMinutes: 75, picName: null, link: '/inbox?prospectId=5&brandId=1' }] },
    });
    const [first, second] = await screen.findAllByRole('link') as [HTMLElement, HTMLElement];
    expect(first.textContent).toContain('Jamaah menunggu balasan');
    expect(first.getAttribute('href')).toBe('/pipeline?quick=reply&pic=mine');
    expect(within(first).getByLabelText('Mendesak')).toBeTruthy();
    expect(second.textContent).toContain('Tidak ada');
    const waiting = screen.getByRole('complementary', { name: 'Jamaah saya yang menunggu balasan' });
    expect(within(waiting).getByText('Ibu Aisyah')).toBeTruthy();
    expect(within(waiting).getByText('1 jam')).toBeTruthy();
  });

  it('semua beres', async () => {
    renderWith({ role: 'finance', tasks: [{ key: 'proofs', label: 'Bukti transfer menunggu', count: 0, hint: null, link: '/verifikasi', tone: 'clear' }], waiting: null });
    expect(await screen.findByText('Semua beres')).toBeTruthy();
  });
});

// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealtimeIndicator } from './AppShell';
import { useUiStore } from './store';
import { EmptyState } from '../components/ui/page-feedback';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Indikator realtime (G14)', () => {
  it('diam saat terhubung; menyambung ulang tampil setelah 4 detik; terputus langsung tampil', () => {
    vi.useFakeTimers();
    act(() => useUiStore.setState({ realtimeStatus: 'online' }));
    render(<MemoryRouter><RealtimeIndicator /></MemoryRouter>);
    expect(screen.getByRole('status').textContent).toBe('');

    act(() => useUiStore.setState({ realtimeStatus: 'connecting' }));
    expect(screen.getByRole('status').textContent).toBe('');
    act(() => { vi.advanceTimersByTime(4100); });
    expect(screen.getByRole('status').textContent).toContain('Menyambung ulang');

    act(() => useUiStore.setState({ realtimeStatus: 'offline' }));
    expect(screen.getByRole('status').textContent).toContain('Pembaruan otomatis terhenti');
  });
});

describe('EmptyState (G16)', () => {
  it('judul, alasan, dan jalan keluar', () => {
    render(<EmptyState title="Tidak ada paket ditemukan" description="Coba sesuaikan filter." action={<button type="button">Reset Filter</button>} />);
    expect(screen.getByText('Tidak ada paket ditemukan')).toBeTruthy();
    expect(screen.getByText('Coba sesuaikan filter.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset Filter' })).toBeTruthy();
  });
});

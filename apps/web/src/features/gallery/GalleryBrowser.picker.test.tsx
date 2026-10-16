// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { api } from '../../lib/api';
import { GalleryBrowser } from './GalleryBrowser';
import type { GalleryAsset } from './galleryApi';

vi.mock('../../app/auth', () => ({ useAuth: () => ({ user: { id: 7, role: 'cs' } }) }));
vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }, resolveMediaUrl: (url: string) => url }));
const feedback = vi.hoisted(() => vi.fn());
vi.mock('../../app/toast', () => ({ showFeedback: feedback }));

const asset = (id: number): GalleryAsset => ({
  id, brandId: 1, folderId: null, name: `Foto ${id}`, url: `/uploads/gallery/${id}.webp`, mimeType: 'image/webp', size: 1000, width: 100, height: 100,
  createdAt: '2026-10-16T01:00:00.000Z', uploadedBy: { id: 7, name: 'Aisyah' },
});
const items = [1, 2, 3, 4].map(asset);

function open(props: Partial<React.ComponentProps<typeof GalleryBrowser>> = {}) {
  const onSelectMany = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <GalleryBrowser brandId={1} mode="picker" onSelectMany={onSelectMany} {...props} />
    </QueryClientProvider>,
  );
  return { onSelectMany };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false }, mutations: { retry: false } });
  vi.mocked(api.get).mockImplementation(async (url: string) => (url.startsWith('/gallery/folders') ? { total: 4, folders: [] } : { items, nextCursor: null }) as any);
});
afterEach(() => cleanup());

describe('Galeri: pilih banyak media untuk dikirim', () => {
  it('klik beberapa media bernomor sesuai urutan klik, lalu dikembalikan berurutan', async () => {
    const { onSelectMany } = open();
    const card = async (name: string) => (await screen.findByRole('button', { name: new RegExp(`^${name}\\b`) }));
    fireEvent.click(await card('Foto 3'));
    fireEvent.click(await card('Foto 1'));
    expect(screen.getByLabelText('Pilihan ke-1').textContent).toBe('1');
    expect(screen.getByText('2 media dipilih')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pilih 2' }));
    expect(onSelectMany).toHaveBeenCalledTimes(1);
    expect(onSelectMany.mock.calls[0]![0].map((a: GalleryAsset) => a.id)).toEqual([3, 1]);
  });

  it('klik lagi membatalkan pilihan dan nomor berikutnya bergeser; Batalkan pilihan mengosongkan', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: /^Foto 1\b/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Foto 2\b/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Foto 1\b/ }));
    expect(screen.getByText('1 media dipilih')).toBeTruthy();
    expect(screen.getByLabelText('Pilihan ke-1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Batalkan pilihan' }));
    expect(screen.queryByText(/media dipilih/)).toBeNull();
  });

  it('melewati batas maksimal: pilihan tambahan ditolak dengan pesan', async () => {
    open({ maxSelect: 2 });
    fireEvent.click(await screen.findByRole('button', { name: /^Foto 1\b/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Foto 2\b/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Foto 3\b/ }));
    await waitFor(() => expect(feedback).toHaveBeenCalledWith('Maksimal 2 media sekali kirim.', { error: true }));
    expect(screen.getByText('2 media dipilih')).toBeTruthy();
  });

  it('total ukuran melewati batas: pilihan tambahan ditolak dengan pesan', async () => {
    const big = (id: number): GalleryAsset => ({ ...asset(id), size: 25 * 1024 * 1024 });
    vi.mocked(api.get).mockImplementation(async (url: string) => (url.startsWith('/gallery/folders') ? { total: 2, folders: [] } : { items: [big(1), big(2)], nextCursor: null }) as any);
    open();
    fireEvent.click(await screen.findByRole('button', { name: /^Foto 1\b/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Foto 2\b/ }));
    await waitFor(() => expect(feedback).toHaveBeenCalledWith('Total ukuran maksimal 40 MB sekali kirim. Kirim sisanya terpisah.', { error: true }));
    expect(screen.getByText('1 media dipilih')).toBeTruthy();
  });

  it('tanpa pilihan tidak ada tombol Pilih', async () => {
    open();
    await screen.findByRole('button', { name: /^Foto 1\b/ });
    expect(screen.queryByRole('button', { name: /^Pilih \d/ })).toBeNull();
  });
});

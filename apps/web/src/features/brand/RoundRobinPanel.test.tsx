// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { api } from '../../lib/api';
import { parsePercent, RoundRobinPanel } from './RoundRobinPanel';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), put: vi.fn() } }));
vi.mock('../../app/toast', () => ({ showFeedback: vi.fn() }));

const settings = (over: Partial<{ enabled: boolean; members: any[] }> = {}) => ({
  enabled: false,
  total: 0,
  members: [
    { userId: 1, name: 'Nisa', percent: 0, assignedCount: 0 },
    { userId: 2, name: 'Rafi', percent: 0, assignedCount: 0 },
  ],
  ...over,
});
const renderPanel = () => render(<QueryClientProvider client={queryClient}><RoundRobinPanel brandId={3} /></QueryClientProvider>);
const save = () => screen.getByRole('button', { name: /Simpan/ }) as HTMLButtonElement;
const type = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  vi.mocked(api.get).mockResolvedValue(settings() as any);
});
afterEach(() => cleanup());

describe('parsePercent', () => {
  it('kosong/huruf menjadi 0, dibatasi 0–100', () => {
    expect(parsePercent('')).toBe(0);
    expect(parsePercent('abc')).toBe(0);
    expect(parsePercent('250')).toBe(100);
    expect(parsePercent('45')).toBe(45);
  });
});

describe('RoundRobinPanel', () => {
  it('menampilkan CS brand dengan jatah dan jumlah terbagi; simpan nonaktif sampai ada perubahan', async () => {
    vi.mocked(api.get).mockResolvedValue(settings({ members: [{ userId: 1, name: 'Nisa', percent: 60, assignedCount: 4 }, { userId: 2, name: 'Rafi', percent: 40, assignedCount: 2 }] }) as any);
    renderPanel();
    expect(((await screen.findByLabelText('Nisa')) as HTMLInputElement).value).toBe('60');
    expect((screen.getByLabelText('Rafi') as HTMLInputElement).value).toBe('40');
    expect(screen.getByRole('status').textContent).toContain('Total 100%');
    expect(save().disabled).toBe(true);
  });

  it('saat aktif, simpan hanya bila total tepat 100%; menyebut kekurangan dan kelebihan', async () => {
    renderPanel();
    await screen.findByLabelText('Nisa');
    fireEvent.click(screen.getByRole('switch', { name: 'Aktifkan round robin CS' }));
    type('Nisa', '60');
    expect(screen.getByRole('status').textContent).toContain('Kurang 40%');
    expect(save().disabled).toBe(true);
    // Isian dibatasi sisa persen: mengetik 60 saat tersisa 40 menjadi 40, total tak bisa melebihi 100%.
    type('Rafi', '60');
    expect((screen.getByLabelText('Rafi') as HTMLInputElement).value).toBe('40');
    expect(screen.getByRole('status').textContent).toContain('Total 100%');
    expect(save().disabled).toBe(false);
    // Menaikkan CS pertama saat CS lain sudah memegang 40 juga dibatasi.
    type('Nisa', '90');
    expect((screen.getByLabelText('Nisa') as HTMLInputElement).value).toBe('60');
  });

  it('mengirim aktif + persen per CS lalu menampilkan hasil dari server', async () => {
    vi.mocked(api.put).mockResolvedValue(settings({ enabled: true, members: [{ userId: 1, name: 'Nisa', percent: 70, assignedCount: 0 }, { userId: 2, name: 'Rafi', percent: 30, assignedCount: 0 }] }) as any);
    renderPanel();
    await screen.findByLabelText('Nisa');
    fireEvent.click(screen.getByRole('switch', { name: 'Aktifkan round robin CS' }));
    type('Nisa', '70');
    type('Rafi', '30');
    fireEvent.click(save());
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/catalog/brands/3/round-robin', { enabled: true, shares: [{ userId: 1, percent: 70 }, { userId: 2, percent: 30 }] }));
    await waitFor(() => expect(save().disabled).toBe(true));
  });

  it('kolom jatah hanya bisa diisi saat round robin aktif', async () => {
    renderPanel();
    const nisa = (await screen.findByLabelText('Nisa')) as HTMLInputElement;
    expect(nisa.disabled).toBe(true);
    expect((screen.getByLabelText('Rafi') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Aktifkan round robin CS' }));
    expect(nisa.disabled).toBe(false);
    fireEvent.click(screen.getByRole('switch', { name: 'Aktifkan round robin CS' }));
    expect(nisa.disabled).toBe(true);
  });

  it('pemuatan ulang yang hanya menaikkan angka "Terbagi" tidak menghapus isian yang belum disimpan', async () => {
    renderPanel();
    await screen.findByLabelText('Nisa');
    fireEvent.click(screen.getByRole('switch', { name: 'Aktifkan round robin CS' }));
    type('Nisa', '40');
    vi.mocked(api.get).mockResolvedValue(settings({ members: [{ userId: 1, name: 'Nisa', percent: 0, assignedCount: 3 }, { userId: 2, name: 'Rafi', percent: 0, assignedCount: 1 }] }) as any);
    await queryClient.refetchQueries({ queryKey: ['round-robin', 3] });
    await waitFor(() => expect(screen.getByLabelText('Nisa').closest('li')!.textContent).toContain('3'));
    expect((screen.getByLabelText('Nisa') as HTMLInputElement).value).toBe('40');
    expect(screen.getByRole('switch', { name: 'Aktifkan round robin CS' }).getAttribute('aria-checked')).toBe('true');
  });

  it('brand tanpa CS aktif: penjelasan, dan tidak bisa diaktifkan', async () => {
    vi.mocked(api.get).mockResolvedValue(settings({ members: [] }) as any);
    renderPanel();
    expect(await screen.findByText(/Belum ada CS aktif/)).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Aktifkan round robin CS' }));
    expect(save().disabled).toBe(true);
  });
});

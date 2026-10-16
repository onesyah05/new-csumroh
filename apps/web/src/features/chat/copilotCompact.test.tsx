// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { api } from '../../lib/api';
import { ChatCopilotPanel } from './ChatCopilotPanel';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() }, resolveMediaUrl: (url: string) => url }));

const scripts = {
  categories: {
    greeting: { scripts: [{ id: 1, title: 'Salam pembuka', script: 'Assalamualaikum.' }] },
    identification: { scripts: [
      { id: 2, title: 'Tanyakan bulan keberangkatan', script: 'Rencana berangkat bulan apa?', category: 'need' },
      { id: 3, title: 'Tanyakan hambatan', script: 'Apa kendalanya?', category: 'pain' },
    ] },
    offer: { scripts: [{ id: 4, title: 'Jadwal paket', script: 'Berangkat Desember.' }] },
  },
};

function renderPanel(extra: Partial<React.ComponentProps<typeof ChatCopilotPanel>> = {}) {
  return render(
    <QueryClientProvider client={queryClient}><MemoryRouter>
      <ChatCopilotPanel brandId={1} prospectName="Bu Aisyah" brandName="Hana Tours" stage="contact" onInsertText={vi.fn()} onShowToast={vi.fn()} {...extra} />
    </MemoryRouter></QueryClientProvider>,
  );
}
const chips = (group: string) => [...screen.getByRole('group', { name: group }).querySelectorAll('button')].map((button) => button.textContent);
const pressed = (group: string) => [...screen.getByRole('group', { name: group }).querySelectorAll('button[aria-pressed="true"]')].map((button) => button.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  vi.mocked(api.get).mockImplementation(async (url: string) => (url.startsWith('/scripts') ? scripts : url.startsWith('/ai/status') ? { enabled: false } : null) as any);
});
afterEach(() => cleanup());

describe('Copilot ringkas', () => {
  it('kategori berupa satu deretan chip (bukan kolom pilihan penuh); awalnya "Sesuai tahap" aktif', async () => {
    renderPanel();
    await screen.findByText('Tanyakan bulan keberangkatan');
    expect(chips('Kategori skrip')).toEqual(['Sesuai tahap', 'Semua', 'Sapaan', 'Kualifikasi', 'Paket & solusi', 'Keberatan', 'Follow-up', 'Pembayaran']);
    expect(pressed('Kategori skrip')).toEqual(['Sesuai tahap']);
    expect(screen.queryByRole('combobox', { name: 'Kategori skrip' })).toBeNull();
  });

  it('judul "Bantuan percakapan" hanya untuk pembaca layar dan memuat nama prospek dan brand', async () => {
    renderPanel();
    await screen.findByText('Tanyakan bulan keberangkatan');
    const heading = screen.getByRole('heading', { name: 'Bantuan percakapan untuk Bu Aisyah · Hana Tours' });
    expect(heading.className).toContain('sr-only');
  });

  it('memilih chip mengganti daftar; label kategori per kartu hanya muncul di "Semua"', async () => {
    renderPanel();
    await screen.findByText('Tanyakan bulan keberangkatan');
    fireEvent.click(screen.getByRole('button', { name: 'Sapaan' }));
    expect(await screen.findByText('Salam pembuka')).toBeTruthy();
    expect(pressed('Kategori skrip')).toEqual(['Sapaan']);
    // Kategori tunggal: label "Sapaan" tidak diulang di kartu (hanya ada di chip).
    expect(screen.getAllByText('Sapaan')).toHaveLength(2); // chip + baris status
    fireEvent.click(screen.getByRole('button', { name: 'Semua' }));
    expect(await screen.findByText('Jadwal paket')).toBeTruthy();
    expect(screen.getAllByText('Kualifikasi').length).toBeGreaterThan(1); // chip + label di kartu
  });

  it('Kualifikasi menambah deretan chip jenis pertanyaan yang menyaring daftar', async () => {
    renderPanel();
    await screen.findByText('Tanyakan bulan keberangkatan');
    expect(screen.queryByRole('group', { name: 'Jenis pertanyaan kualifikasi' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Kualifikasi' }));
    expect(chips('Jenis pertanyaan kualifikasi')).toEqual(['Semua pertanyaan', 'Kebutuhan', 'Hambatan', 'Manfaat yang dicari', 'Harapan', 'Informasi praktis']);
    fireEvent.click(screen.getByRole('button', { name: 'Hambatan' }));
    expect(await screen.findByText('Tanyakan hambatan')).toBeTruthy();
    expect(screen.queryByText('Tanyakan bulan keberangkatan')).toBeNull();
    expect(pressed('Jenis pertanyaan kualifikasi')).toEqual(['Hambatan']);
  });

  it('pindah kategori mengembalikan jenis pertanyaan ke "Semua pertanyaan"', async () => {
    renderPanel();
    await screen.findByText('Tanyakan bulan keberangkatan');
    fireEvent.click(screen.getByRole('button', { name: 'Kualifikasi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hambatan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sapaan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kualifikasi' }));
    expect(pressed('Jenis pertanyaan kualifikasi')).toEqual(['Semua pertanyaan']);
  });

  it('mencari menyembunyikan chip (pencarian lintas kategori); menghapus pencarian mengembalikannya', async () => {
    renderPanel();
    await screen.findByText('Tanyakan bulan keberangkatan');
    fireEvent.change(screen.getByLabelText('Cari di semua skrip'), { target: { value: 'hambatan' } });
    expect(screen.queryByRole('group', { name: 'Kategori skrip' })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Hasil pencarian');
    expect(screen.getByRole('status').textContent).toContain('1 skrip dari semua kategori');
    fireEvent.click(screen.getByRole('button', { name: 'Hapus pencarian' }));
    expect(screen.getByRole('group', { name: 'Kategori skrip' })).toBeTruthy();
  });

  it('satu baris status: tahap, jumlah skrip, dan paket aktif', async () => {
    renderPanel({ packageName: 'Umroh Reguler 9 Hari' });
    await screen.findByText('Tanyakan bulan keberangkatan');
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Siap dipakai · tahap Kualifikasi');
    expect(status.textContent).toContain('2 skrip');
    expect(status.textContent).toContain('Umroh Reguler 9 Hari');
    expect(status.getAttribute('title')).toBe('Paket: Umroh Reguler 9 Hari');
    fireEvent.click(screen.getByRole('button', { name: 'Semua' }));
    expect(screen.getByRole('status').textContent).toContain('Semua kategori · 4 skrip');
  });
});

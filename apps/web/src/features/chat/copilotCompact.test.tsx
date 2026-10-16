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
const group = (name: string) => screen.queryByRole('group', { name });
const chips = (name: string) => [...screen.getByRole('group', { name }).querySelectorAll('button')].map((button) => button.textContent);
const pressed = (name: string) => [...screen.getByRole('group', { name }).querySelectorAll('button[aria-pressed="true"]')].map((button) => button.textContent);
const filterToggle = () => screen.getByRole('button', { name: 'Ubah kategori skrip' });
const openFilter = () => fireEvent.click(filterToggle());
const searchToggle = () => screen.getByRole('button', { name: 'Cari skrip' });

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  vi.mocked(api.get).mockImplementation(async (url: string) => (url.startsWith('/scripts') ? scripts : url.startsWith('/ai/status') ? { enabled: false } : null) as any);
});
afterEach(() => cleanup());

describe('Copilot: filter dan pencarian hanya tampil saat dibutuhkan', () => {
  it('awalnya hanya satu baris: tombol kategori (menyebut pilihan aktif) dan tombol cari; tanpa kolom isian dan tanpa chip', async () => {
    renderPanel();
    await screen.findByText('Tanyakan bulan keberangkatan');
    expect(filterToggle().textContent).toBe('Sesuai tahap · Kualifikasi');
    expect(filterToggle().getAttribute('aria-expanded')).toBe('false');
    expect(group('Kategori skrip')).toBeNull();
    expect(screen.queryByLabelText('Cari di semua skrip')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull(); // tidak ada isian yang memancing keyboard
  });

  it('judul "Bantuan percakapan" hanya untuk pembaca layar dan memuat nama prospek dan brand', async () => {
    renderPanel();
    await screen.findByText('Tanyakan bulan keberangkatan');
    const heading = screen.getByRole('heading', { name: 'Bantuan percakapan untuk Bu Aisyah · Hana Tours' });
    expect(heading.className).toContain('sr-only');
  });

  it('membuka tombol kategori menampilkan chip; memilih satu menutupnya dan menggantinya di tombol', async () => {
    renderPanel();
    await screen.findByText('Tanyakan bulan keberangkatan');
    openFilter();
    expect(chips('Kategori skrip')).toEqual(['Sesuai tahap', 'Semua', 'Sapaan', 'Kualifikasi', 'Paket & solusi', 'Keberatan', 'Follow-up', 'Pembayaran']);
    expect(pressed('Kategori skrip')).toEqual(['Sesuai tahap']);
    fireEvent.click(screen.getByRole('button', { name: 'Sapaan' }));
    expect(await screen.findByText('Salam pembuka')).toBeTruthy();
    expect(group('Kategori skrip')).toBeNull();
    expect(filterToggle().textContent).toBe('Sapaan');
    expect(filterToggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('label kategori per kartu hanya muncul di "Semua skrip"', async () => {
    renderPanel();
    await screen.findByText('Tanyakan bulan keberangkatan');
    openFilter();
    fireEvent.click(screen.getByRole('button', { name: 'Sapaan' }));
    await screen.findByText('Salam pembuka');
    // Selain tombol kategori, label "Sapaan" tidak diulang di kartu.
    expect(screen.queryAllByText('Sapaan').filter(element => !filterToggle().contains(element))).toHaveLength(0);
    openFilter();
    fireEvent.click(screen.getByRole('button', { name: 'Semua' }));
    expect(await screen.findByText('Jadwal paket')).toBeTruthy();
    expect(filterToggle().textContent).toBe('Semua skrip');
    expect(screen.queryAllByText('Kualifikasi').filter(element => !filterToggle().contains(element)).length).toBeGreaterThan(0); // label di kartu
  });

  it('Kualifikasi tetap terbuka untuk memilih jenis pertanyaan, lalu menutup dan menyaring daftar', async () => {
    renderPanel();
    await screen.findByText('Tanyakan bulan keberangkatan');
    openFilter();
    expect(group('Jenis pertanyaan kualifikasi')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Kualifikasi' }));
    expect(chips('Jenis pertanyaan kualifikasi')).toEqual(['Semua pertanyaan', 'Kebutuhan', 'Hambatan', 'Manfaat yang dicari', 'Harapan', 'Informasi praktis']);
    fireEvent.click(screen.getByRole('button', { name: 'Hambatan' }));
    expect(await screen.findByText('Tanyakan hambatan')).toBeTruthy();
    expect(screen.queryByText('Tanyakan bulan keberangkatan')).toBeNull();
    expect(group('Kategori skrip')).toBeNull();
    expect(filterToggle().textContent).toBe('Kualifikasi · Hambatan');
  });

  it('pindah kategori mengembalikan jenis pertanyaan ke "Semua pertanyaan"', async () => {
    renderPanel();
    await screen.findByText('Tanyakan bulan keberangkatan');
    openFilter();
    fireEvent.click(screen.getByRole('button', { name: 'Kualifikasi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hambatan' }));
    openFilter();
    fireEvent.click(screen.getByRole('button', { name: 'Sapaan' }));
    openFilter();
    fireEvent.click(screen.getByRole('button', { name: 'Kualifikasi' }));
    expect(pressed('Jenis pertanyaan kualifikasi')).toEqual(['Semua pertanyaan']);
  });

  it('tombol cari membuka kolom pencarian (terfokus); menutupnya menghapus pencarian', async () => {
    renderPanel();
    await screen.findByText('Tanyakan bulan keberangkatan');
    fireEvent.click(searchToggle());
    const input = screen.getByLabelText('Cari di semua skrip') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: 'hambatan' } });
    expect(filterToggle().textContent).toBe('Hasil pencarian');
    expect(screen.getByRole('status').textContent).toContain('1 skrip dari semua kategori');
    // Pencarian lintas kategori: chip tidak ditampilkan walau tombol kategori dibuka.
    openFilter();
    expect(group('Kategori skrip')).toBeNull();
    fireEvent.click(searchToggle());
    expect(screen.queryByLabelText('Cari di semua skrip')).toBeNull();
    expect(filterToggle().textContent).toBe('Sesuai tahap · Kualifikasi');
    expect(await screen.findByText('Tanyakan bulan keberangkatan')).toBeTruthy();
  });

  it('satu baris status: jumlah skrip siap dipakai dan paket aktif', async () => {
    renderPanel({ packageName: 'Umroh Reguler 9 Hari' });
    await screen.findByText('Tanyakan bulan keberangkatan');
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('2 skrip siap dipakai');
    expect(status.textContent).toContain('Umroh Reguler 9 Hari');
    expect(status.getAttribute('title')).toBe('Paket: Umroh Reguler 9 Hari');
    openFilter();
    fireEvent.click(screen.getByRole('button', { name: 'Semua' }));
    expect(screen.getByRole('status').textContent).toContain('4 skrip');
    expect(screen.getByRole('status').textContent).not.toContain('siap dipakai');
  });

  it('catatan pengiriman di bawah hanya tampil di layar lebar (tidak memakan ruang di HP)', async () => {
    renderPanel();
    await screen.findByText('Tanyakan bulan keberangkatan');
    const footer = screen.getByText('Skrip masuk ke draft; dikirim lewat tombol WhatsApp.');
    expect(footer.className).toContain('max-sm:hidden');
  });

  it('bilah filter ikut tergulung bersama daftar (tidak terpasang tetap di atas)', async () => {
    renderPanel();
    await screen.findByText('Tanyakan bulan keberangkatan');
    const scroller = filterToggle().closest('.overflow-y-auto');
    expect(scroller).not.toBeNull();
    expect(scroller!.contains(screen.getByText('Tanyakan bulan keberangkatan'))).toBe(true);
  });
});

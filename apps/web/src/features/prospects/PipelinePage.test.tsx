// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../app/auth';
import { queryClient } from '../../app/query';
import { useUiStore } from '../../app/store';
import { PipelinePage } from './PipelinePage';

const brand = { id: 1, name: 'Hana', code: 'HANA' };
const prospects = [
  { id: 1, brandId: 1, name: 'Deal Syawal', phone: '62811', status: 'deal', packageId: 10, package: { id: 10, name: 'Syawal' }, dealValue: 60_000_000, userId: 7, user: { id: 7, name: 'CS Fitri' }, leadSource: 'whatsapp', messages: [] },
  { id: 6, brandId: 1, name: 'Baru Menunggu', phone: '62816', status: 'contact', awaitingSince: Math.floor(Date.now() / 1000) - 5 * 60, packageId: null, dealValue: 0, userId: 7, user: { id: 7, name: 'CS Fitri' }, leadSource: 'whatsapp', messages: [] },
  { id: 2, brandId: 1, name: 'Deal Ramadhan', phone: '62812', status: 'closed_won', packageId: 11, package: { id: 11, name: 'Ramadhan' }, dealValue: 50_000_000, userId: 7, user: { id: 7, name: 'CS Fitri' }, leadSource: 'whatsapp', messages: [] },
  { id: 3, brandId: 1, name: '62813', phone: '62813', status: 'new', packageId: null, dealValue: 0, userId: null, user: null, leadSource: 'whatsapp', messages: [{ timestamp: Math.floor(Date.now() / 1000) - 600, isFromMe: false }] },
  { id: 4, brandId: 1, name: 'Keberatan Harga', phone: '62814', status: 'objection', objectionCategory: 'price', awaitingSince: Math.floor(Date.now() / 1000) - 20 * 60, photoUrl: `/uploads/avatars/p4-${Date.now()}-ab12.jpg`, packageId: null, dealValue: 0, userId: 7, user: { id: 7, name: 'CS Fitri' }, leadSource: 'whatsapp', messages: [] },
  { id: 5, brandId: 1, name: 'Milik Tester', phone: '62815', status: 'contact', packageId: null, dealValue: 0, userId: 9, user: { id: 9, name: 'Tester' }, leadSource: 'whatsapp', messages: [] },
];

function json(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as Response);
}

function renderAs(role: string, url = '/pipeline') {
  const user = { id: 9, name: 'Tester', email: 't@x.id', role, brandId: 1, brand, userBrands: [] };
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes('/auth/refresh')) return json({ accessToken: 't', user });
    if (u.includes('/pic-candidates')) return json([{ id: 7, name: 'CS Fitri', openProspects: 3 }, { id: 9, name: 'Tester', openProspects: 1 }]);
    if (u.includes('/prospects')) return json(prospects);
    if (u.includes('/catalog/packages')) return json([{ id: 10, name: 'Syawal' }, { id: 11, name: 'Ramadhan' }]);
    return json([]);
  }));
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <AuthProvider><PipelinePage /></AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient.clear();
  useUiStore.setState({ activeBrandId: 1 });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Pipeline', () => {
  it('mobile kembali ke Tabel secara bawaan dan dapat beralih ke Papan', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    renderAs('admin', '/pipeline');
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Tabel$/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Ekspor CSV' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Tahap prospek' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Papan$/ }));
    expect(await screen.findByRole('article', { name: 'Kartu prospek Deal Syawal' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
  it('lingkup Deal digabung dengan filter paket (AND), dari URL; tautan lama ?quick=won tetap berlaku', async () => {
    renderAs('admin', '/pipeline?view=table&lingkup=deal&paket=10');
    expect(await screen.findByText('Deal Syawal')).toBeTruthy();
    expect(screen.queryByText('Deal Ramadhan')).toBeNull();
    // Status & paket tampil sebagai chip filter aktif yang bisa dihapus; toolbar tidak punya tombol lingkup.
    expect(screen.getByRole('button', { name: 'Hapus filter Status: Deal' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hapus filter Paket: Syawal' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Lingkup prospek' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hapus filter Status: Deal' }));
    expect(await screen.findByText('Tidak ada prospek yang cocok dengan pencarian atau filter ini.')).toBeTruthy();
    cleanup();
    queryClient.clear();
    renderAs('admin', '/pipeline?view=table&quick=won');
    expect(await screen.findByText('Deal Ramadhan')).toBeTruthy();
    expect(screen.queryByText('Keberatan Harga')).toBeNull();
  });

  it('Tabel: bawaan lingkup Aktif (Deal/Batal disembunyikan); filter cepat urut mendesak, jumlah 0 dipudarkan', async () => {
    renderAs('admin', '/pipeline?view=table');
    expect(await screen.findByText('Keberatan Harga')).toBeTruthy();
    expect(screen.queryByText('Deal Syawal')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Lingkup prospek' })).toBeNull();
    const chips = within(screen.getByRole('group', { name: 'Filter cepat' })).getAllByRole('button');
    expect(chips.map((b) => b.textContent?.replace(/\d+$/, ''))).toEqual(['Semua', 'Follow-up terlambat', 'Menunggu balasan', 'Belum ada PIC', 'Follow-up hari ini', 'Minat tinggi']);
    expect(chips.some((b) => /Deal|Batal/.test(b.textContent ?? ''))).toBe(false);
    expect(chips[1]!.className).toContain('border-dashed');
    cleanup();
    queryClient.clear();
    renderAs('admin', '/pipeline?view=table&lingkup=semua');
    expect(await screen.findByText('Deal Syawal')).toBeTruthy();
  });

  it('Papan tidak memakai lingkup: kolom Deal tetap berisi', async () => {
    renderAs('admin', '/pipeline?view=kanban');
    expect(await screen.findByRole('article', { name: 'Kartu prospek Deal Syawal' })).toBeTruthy();
    expect(screen.queryByLabelText('Filter status')).toBeNull();
  });

  it('klaim hanya untuk CS; admin mendapat "Tugaskan PIC"', async () => {
    renderAs('admin', '/pipeline?view=table');
    await screen.findByText('Keberatan Harga');
    expect(screen.queryByRole('button', { name: /Klaim/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /Tugaskan PIC/ }).length).toBeGreaterThan(0);
    cleanup();
    queryClient.clear();
    renderAs('cs', '/pipeline?view=table');
    await screen.findByText('Keberatan Harga');
    expect(screen.getAllByRole('button', { name: /Klaim/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Tugaskan PIC/ })).toBeNull();
  });

  it('kartu: tidak menampilkan nomor dua kali, "Belum ada penawaran" alih-alih Rp 0, dan sinyal menunggu balasan', async () => {
    renderAs('cs');
    const card = await screen.findByRole('article', { name: 'Kartu prospek 62813' });
    expect(within(card).queryByText(/Rp 0/)).toBeNull();
    expect(within(card).getByText('Belum ada penawaran')).toBeTruthy();
    expect(within(card).getByText(/^Menunggu balasan · 10 mnt$/)).toBeTruthy();
    expect(within(card).getAllByText(/62813/)).toHaveLength(1);
    // Aksi utama selalu ada di DOM dan berlabel (tidak bergantung hover).
    expect(within(card).getByRole('link', { name: 'Buka chat 62813' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Catat follow-up 62813' })).toBeTruthy();
  });

  it('lencana keberatan menampilkan label, bukan kode internal', async () => {
    renderAs('cs');
    const card = await screen.findByRole('article', { name: 'Kartu prospek Keberatan Harga' });
    expect(within(card).getByText('Harga')).toBeTruthy();
    expect(within(card).queryByText('price')).toBeNull();
  });

  it('avatar memakai foto profil WhatsApp; tanpa foto tampil siluet, bukan inisial', async () => {
    renderAs('cs');
    const withPhoto = await screen.findByRole('article', { name: 'Kartu prospek Keberatan Harga' });
    expect(withPhoto.querySelector('img')?.getAttribute('src')).toMatch(/\/uploads\/avatars\/p4-\d+-ab12\.jpg$/);
    const noPhoto = screen.getByRole('article', { name: 'Kartu prospek Deal Syawal' });
    expect(noPhoto.querySelector('[data-avatar="placeholder"]')).toBeTruthy();
    expect(within(noPhoto).queryByText(/^DS$/)).toBeNull();
  });

  it('filter tanpa hasil menampilkan pesan dan tombol hapus semua filter', async () => {
    renderAs('admin', '/pipeline?view=table&q=tidakada');
    expect(await screen.findByText('Tidak ada prospek yang cocok dengan pencarian atau filter ini.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hapus semua filter' }));
    expect(await screen.findByText('Keberatan Harga')).toBeTruthy();
  });

  it('Finance: semua kartu hanya-baca (sama dengan aturan API), tanpa follow-up dan tidak bisa diseret', async () => {
    renderAs('finance');
    const card = await screen.findByRole('article', { name: 'Kartu prospek Milik Tester' });
    expect(card.getAttribute('draggable')).toBe('false');
    expect(card.getAttribute('title')).toBe('Finance hanya menangani bukti transfer dan verifikasi pembayaran.');
    expect(screen.queryAllByRole('button', { name: /Catat follow-up/ })).toHaveLength(0);
  });

  it('CS bukan PIC: kartu hanya-baca (tanpa follow-up dan tidak bisa diseret)', async () => {
    renderAs('cs');
    const card = await screen.findByRole('article', { name: 'Kartu prospek Keberatan Harga' });
    expect(card.getAttribute('draggable')).toBe('false');
    expect(within(card).queryByRole('button', { name: /Catat follow-up/ })).toBeNull();
    const own = screen.getByRole('article', { name: 'Kartu prospek Milik Tester' });
    expect(own.getAttribute('draggable')).toBe('true');
    expect(within(own).getByRole('button', { name: 'Catat follow-up Milik Tester' })).toBeTruthy();
  });

  it('PIC dapat menyerahkan prospeknya; daftar CS menampilkan beban kerja', async () => {
    renderAs('cs');
    const own = await screen.findByRole('article', { name: 'Kartu prospek Milik Tester' });
    fireEvent.click(within(own).getByRole('button', { name: /^Serahkan PIC Milik Tester/ }));
    expect(await screen.findByRole('dialog', { name: 'Serahkan PIC' })).toBeTruthy();
    expect(screen.getByLabelText('Alasan')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Serahkan' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('filter "PIC saya" dari URL hanya menampilkan prospek milik CS ini', async () => {
    renderAs('cs', '/pipeline?view=table&pic=mine');
    expect(await screen.findByText('Milik Tester')).toBeTruthy();
    expect(screen.queryByText('Deal Syawal')).toBeNull();
  });

  it('ambil alih muncul hanya setelah jamaah belum dibalas lebih dari 15 menit', async () => {
    renderAs('cs');
    const late = await screen.findByRole('article', { name: 'Kartu prospek Keberatan Harga' });
    const button = within(late).getByRole('button', { name: 'Ambil alih Keberatan Harga dari CS Fitri' });
    const early = screen.getByRole('article', { name: 'Kartu prospek Baru Menunggu' });
    expect(within(early).queryByRole('button', { name: /Ambil alih/ })).toBeNull();
    fireEvent.click(button);
    await vi.waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
      expect(calls.some((u) => u.includes('/prospects/4/takeover'))).toBe(true);
    });
  });

  it('admin tidak mendapat tombol ambil alih (memakai Tugaskan PIC)', async () => {
    renderAs('admin');
    const late = await screen.findByRole('article', { name: 'Kartu prospek Keberatan Harga' });
    expect(within(late).queryByRole('button', { name: /Ambil alih/ })).toBeNull();
  });
});

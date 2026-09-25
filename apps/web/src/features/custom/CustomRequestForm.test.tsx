// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { api } from '../../lib/api';
import { CustomRequestForm } from './CustomRequestForm';
import { emptyCustomInput } from './customApi';

vi.mock('../../lib/api', () => ({ api: { post: vi.fn(async () => ({})), patch: vi.fn(async () => ({})) } }));
const packages = [{
  id: 5, name: 'Umroh Akhir Tahun Bintang 5', isActive: true, departureDate: '2099-12-24T00:00:00.000Z', duration: '10 hari',
  airline: 'Saudia', flightType: 'direct', hotelMakkah: 'Swissotel', hotelMadinah: 'Pullman', quotaRemaining: 12,
  facilitiesIncluded: 'Tiket pesawat PP\nVisa umroh\nPerlengkapan umroh\nMuthawif',
}];
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
const renderForm = (initial = { ...emptyCustomInput({ paxQuad: 2 }), basePackageId: 5 }) =>
  render(<CustomRequestForm open onClose={vi.fn()} prospectId={11} brandId={1} initial={initial} packages={packages} onSaved={vi.fn()} />, { wrapper });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Form layanan custom', () => {
  it('mengubah kebutuhan yang sudah dihargai saat invoice terkirim: invoice ikut dibatalkan secara sadar', async () => {
    const initial = { ...emptyCustomInput({ paxQuad: 2 }), basePackageId: 5 };
    render(<CustomRequestForm open onClose={vi.fn()} prospectId={11} brandId={1} initial={initial} existing={{ id: 4, status: 'agreed', mode: 'package' } as any}
      openInvoice="INV/202609/0011" packages={packages} onSaved={vi.fn()} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Periksa' }));
    expect(screen.getByRole('alert').textContent).toContain('Invoice INV/202609/0011 ikut dibatalkan');
    fireEvent.click(screen.getByRole('button', { name: 'Batalkan invoice & minta hitung ulang' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect((vi.mocked(api.patch).mock.calls[0]! as [string, any])[1]).toMatchObject({ voidInvoice: true });
  });

  it('diawali pilihan jenis; berbasis paket memakai tanggal & pesawat paket dan hanya mencatat perubahannya', async () => {
    renderForm();
    expect(screen.getByRole('radio', { name: /Berbasis paket/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: /Full custom/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(screen.getByText('24 Desember 2099 · 10 hari')).toBeTruthy();
    expect(screen.getByText('Saudia · Direct')).toBeTruthy();
    expect(screen.queryByLabelText('Tanggal keberangkatan')).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Rute' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Extend malam di Makkah'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Ganti hotel Madinah'), { target: { value: 'Dar Al Taqwa' } });
    expect(screen.getByText('2 malam')).toBeTruthy();
    // Layanan paket tampil sebagai centang; hapus centang = dikurangi. Tambahan yang sudah ada di paket tidak ditawarkan lagi.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Perlengkapan umroh' }));
    expect(screen.queryByRole('switch', { name: 'Perlengkapan' })).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Kereta cepat' }));
    fireEvent.change(screen.getByPlaceholderText(/Layanan lain/), { target: { value: 'Handling bandara VIP' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tambah' }));
    expect(screen.getByText('Dikurangi 1 · Ditambah 2')).toBeTruthy();
    // Langkah periksa menampilkan ringkasan seperti yang dibaca Tim LA.
    fireEvent.click(screen.getByRole('button', { name: 'Periksa' }));
    expect(screen.getByRole('region', { name: 'Layanan' })).toBeTruthy();
    expect(screen.getByText('Perlengkapan umroh')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Kirim ke Tim LA' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = vi.mocked(api.post).mock.calls[0]! as [string, any];
    expect(url).toBe('/custom-requests/prospect/11');
    expect(body).toMatchObject({ mode: 'package', basePackageId: 5, extendNightsMakkah: 2, hotelMadinah: 'Dar Al Taqwa',
      servicesRemoved: ['Perlengkapan umroh'], servicesAdded: ['Kereta cepat', 'Handling bandara VIP'] });
  });

  it('pilihan jenis bisa dipindah dengan panah keyboard (satu posisi Tab per grup)', () => {
    renderForm();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('tabindex'))).toEqual(['0', '-1']);
    fireEvent.keyDown(screen.getByRole('radiogroup', { name: 'Jenis layanan custom' }), { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: /Full custom/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('full custom memakai tanggal pasti atau rentang tanggal (bukan teks bebas) dan tidak mengirim paket dasar', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('radio', { name: /Full custom/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(screen.queryByLabelText('Atau perkiraan')).toBeNull();
    expect(screen.getByText(/Lengkapi: tanggal keberangkatan/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Rentang tanggal' }));
    fireEvent.change(screen.getByLabelText('Berangkat paling cepat'), { target: { value: '2027-02-10' } });
    expect(screen.getByText(/Lengkapi: tanggal akhir rentang/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Periksa' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Berangkat paling lambat'), { target: { value: '2027-02-17' } });
    // Full custom wajib jumlah malam Makkah & Madinah (boleh 0).
    expect(screen.getByText(/Lengkapi: malam Makkah, malam Madinah/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Malam di Makkah'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Malam di Madinah'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Periksa' }));
    expect(screen.getByText('10–17 Februari 2027')).toBeTruthy();
    // Total malam tampil setelah semua hotel.
    const hotelRows = [...screen.getByRole('region', { name: 'Hotel & malam' }).querySelectorAll('dt')].map((dt) => dt.textContent);
    expect(hotelRows.at(-1)).toBe('Total');
    fireEvent.click(screen.getByRole('button', { name: 'Kirim ke Tim LA' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect((vi.mocked(api.post).mock.calls[0]! as [string, any])[1]).toMatchObject({ mode: 'full', basePackageId: null, departureDate: '2027-02-10', departureDateTo: '2027-02-17' });
  });
});

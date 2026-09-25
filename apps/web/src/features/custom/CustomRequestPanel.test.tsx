// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { api } from '../../lib/api';
import { CustomRequestPanel } from './CustomRequestPanel';
import { customBadge, formatCustomOffer, type CustomRequest } from './customApi';

vi.mock('../../lib/api', () => ({ api: { post: vi.fn(async () => ({})) } }));

const base: CustomRequest = {
  id: 4, brandId: 1, prospectId: 11, status: 'quoted', mode: 'full', basePackageId: null, extendNightsMakkah: null, extendNightsMadinah: null,
  departureDateTo: null, servicesRemoved: null, servicesAdded: null, offeredPrices: { quad: 38_000_000 }, floorPrices: { quad: 35_000_000 },
  returnNote: null, queuedAt: null, quoteCount: 1, minDpInfant: null,
  departureDate: '2027-02-10T00:00:00.000Z', departureNote: null, departureCity: 'Jakarta', airline: 'Saudia', flightType: 'direct',
  paxQuad: 2, paxTriple: 0, paxDouble: 0, paxInfant: 0, hotelMakkah: 'Fairmont', nightsMakkah: 5, hotelMadinah: 'Dar Al Taqwa', nightsMadinah: 4,
  extraHotels: [], route: 'madinah_first', equipment: true, fastTrain: true, tourLeader: false, muthawif: true, cityTour: 'Thaif',
  budgetPerPax: 35_000_000, specialNeeds: null, notes: null,
  offeredPrice: 76_000_000, floorPrice: 70_000_000, minDpPerPax: 10_000_000, quoteValidUntil: new Date(Date.now() + 86_400_000).toISOString(),
  quoteNote: null, quotedAt: null, revisionNote: null, agreedPrice: null, agreedAt: null, createdAt: '', updatedAt: new Date().toISOString(),
};
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Layanan custom (CS)', () => {
  it('menampilkan rentang harga; nilai di bawah harga terendah tidak bisa disepakati', async () => {
    render(<CustomRequestPanel request={base} prospectId={11} readOnly={false} onEdit={vi.fn()} onShowToast={vi.fn()} />, { wrapper });
    expect(screen.getByText('Rp76.000.000')).toBeTruthy();
    expect(screen.getByText('Rp70.000.000')).toBeTruthy();
    expect(screen.getByText('Rp20.000.000')).toBeTruthy();
    const input = screen.getByLabelText('Nilai deal akhir (total)') as HTMLInputElement;
    // Sengaja kosong: diisi setelah ada kesepakatan; tombol cepat mengisi harga ditawarkan.
    expect(input.value).toBe('');
    expect((screen.getByRole('button', { name: 'Sepakati' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Pakai harga ditawarkan' }));
    expect(input.value).toBe('76.000.000');
    fireEvent.change(input, { target: { value: '72.000.000' } });
    expect(screen.getByText(/Potongan Rp4\.000\.000 \(5,3%\)|Potongan Rp4\.000\.000 \(5\.3%\)/)).toBeTruthy();
    fireEvent.change(input, { target: { value: '69.000.000' } });
    expect(screen.getByText(/Nilai ini tidak dapat disepakati/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Sepakati' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: '72000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sepakati' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/custom-requests/4/agree', { agreedPrice: 72_000_000 }));
  });

  it('harga yang hampir kedaluwarsa diberi hitung mundur; dikembalikan Tim LA meminta CS melengkapi', () => {
    const soon = { ...base, quoteValidUntil: new Date(Date.now() + 5 * 3_600_000 + 60_000).toISOString() };
    const view = render(<CustomRequestPanel request={soon} prospectId={11} readOnly={false} onEdit={vi.fn()} onShowToast={vi.fn()} />, { wrapper });
    expect(screen.getByText(/5 jam lagi/)).toBeTruthy();
    view.unmount();
    const onEdit = vi.fn();
    render(<CustomRequestPanel request={{ ...base, status: 'needs_info', returnNote: 'Hotel Madinah penuh' }} prospectId={11} readOnly={false} onEdit={onEdit} onShowToast={vi.fn()} />, { wrapper });
    expect(screen.getByRole('alert').textContent).toContain('Hotel Madinah penuh');
    fireEvent.click(screen.getByRole('button', { name: 'Lengkapi & kirim ulang' }));
    expect(onEdit).toHaveBeenCalled();
  });

  it('setelah disepakati: batas berlaku disembunyikan dan petunjuk mengikuti tahap prospek', () => {
    const agreed = { ...base, status: 'agreed', agreedPrice: 72_000_000, quoteValidUntil: new Date(Date.now() - 86_400_000).toISOString() };
    const view = render(<CustomRequestPanel request={agreed} prospectId={11} readOnly={false} progress={{ offerSent: true, invoiceSent: false, won: false }} onEdit={vi.fn()} onShowToast={vi.fn()} />, { wrapper });
    expect(screen.queryByText('Berlaku sampai')).toBeNull();
    expect(screen.getByText(/Penawaran terkirim; kirim invoice minimal DP/)).toBeTruthy();
    view.unmount();
    render(<CustomRequestPanel request={agreed} prospectId={11} readOnly progress={{ offerSent: true, invoiceSent: true, won: true }} onEdit={vi.fn()} onShowToast={vi.fn()} />, { wrapper });
    expect(screen.getByText(/Deal; pemesanan dilanjutkan Tim LA/)).toBeTruthy();
    // Naskah penawaran untuk harga yang sudah disepakati tidak menyebut batas berlaku (bisa sudah lewat).
    expect(formatCustomOffer(agreed, 72_000_000)).not.toContain('berlaku sampai');
  });

  it('nilai deal jauh di atas harga ditawarkan meminta konfirmasi; label status dari sudut pandang CS', async () => {
    render(<CustomRequestPanel request={base} prospectId={11} readOnly={false} onEdit={vi.fn()} onShowToast={vi.fn()} />, { wrapper });
    fireEvent.change(screen.getByLabelText('Nilai deal akhir (total)'), { target: { value: '760.000.000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sepakati' }));
    expect(await screen.findByText('Nilai deal di atas harga ditawarkan?')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ya, sepakati' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/custom-requests/4/agree', { agreedPrice: 760_000_000 }));
    cleanup();
    render(<CustomRequestPanel request={{ ...base, status: 'needs_info', returnNote: 'x' }} prospectId={11} readOnly={false} onEdit={vi.fn()} onShowToast={vi.fn()} />, { wrapper });
    expect(screen.getByText('Perlu Anda lengkapi')).toBeTruthy();
  });

  it('custom berbasis paket tetap bisa mengirim flyer & itinerary paket dasar; penanda daftar ringkas', () => {
    const flyer = vi.fn();
    render(<CustomRequestPanel request={{ ...base, mode: 'package' }} prospectId={11} readOnly={false} baseActions={{ name: 'Paket A', onSendFlyer: flyer }} onEdit={vi.fn()} onShowToast={vi.fn()} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Kirim flyer Paket A ke chat' }));
    expect(flyer).toHaveBeenCalled();
    expect(customBadge({ status: 'needs_info' })).toEqual({ text: 'Custom: perlu dilengkapi', urgent: true });
    expect(customBadge({ status: 'submitted' })?.urgent).toBe(false);
    expect(customBadge({ status: 'quoted', quoteValidUntil: new Date(Date.now() + 3 * 3_600_000).toISOString() })?.urgent).toBe(true);
    expect(customBadge(null)).toBeNull();
  });

  it('naskah penawaran hanya memuat nilai deal, bukan harga terendah', () => {
    const text = formatCustomOffer(base, 72_000_000);
    expect(text).toContain('*Total: Rp72.000.000*');
    // Rincian per tipe kamar + potongan khusus + batas berlaku.
    expect(text).toContain('• Quad 2 × Rp38.000.000');
    expect(text).toContain('• Potongan khusus: −Rp4.000.000');
    expect(text).toContain('Harga berlaku sampai');
    expect(text).toContain('Hotel Makkah: Fairmont (5 malam)');
    expect(text).toContain('Total 9 malam');
    expect(text).toContain('• Kereta cepat');
    expect(text).toContain('ditambah Thaif');
    expect(text).not.toContain('70.000.000');
  });
});

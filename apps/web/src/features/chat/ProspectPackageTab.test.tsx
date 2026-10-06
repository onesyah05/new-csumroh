// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buttonVariants } from '../../components/ui/button';
import { ProspectPackageTab } from './ProspectPackageTab';

afterEach(cleanup);

describe('Tab paket tanpa paket terpilih', () => {
  it('"Pilih paket" memakai tombol bersama (sama dengan "Lengkapi kualifikasi"), bukan tombol polos', () => {
    render(
      <ProspectPackageTab
        packages={[]} selected={null} qualification={{} as never} locked={false} saving={false} connected
        onSelect={vi.fn()} onSendFlyer={vi.fn()} onInsertSummary={vi.fn()} onInsertItinerary={vi.fn()}
        onOpenGallery={vi.fn()} onOpenQualification={vi.fn()}
      />,
    );
    // Tinggi tetap (h-8) dari komponen bersama: tombol polos ikut metrik font browser dan tampil beda di Chrome.
    expect(screen.getByRole('button', { name: 'Pilih paket' }).className).toBe(buttonVariants({ variant: 'secondary', size: 'sm' }));
  });
});

describe('Detail paket', () => {
  it('hanya "Sudah termasuk"; tidak ada bagian "Keunggulan" yang mengulang fasilitas', () => {
    const pkg = {
      id: 1, name: 'Umroh Reguler', price: 'Rp 30.000.000', priceQuad: 'Rp 30.000.000', dp: 'Rp 5.000.000', isActive: true,
      departureDate: '2026-12-01', facilitiesIncluded: 'Tiket Pesawat PP\nVisa Umroh', highlights: 'Tiket Pesawat PP\nVisa Umroh',
    };
    render(
      <ProspectPackageTab
        packages={[pkg as never]} selected={pkg as never} qualification={{ paxQuad: 1, paxTriple: 0, paxDouble: 0, paxInfant: 0 }} locked={false} saving={false} connected
        onSelect={vi.fn()} onSendFlyer={vi.fn()} onInsertSummary={vi.fn()} onInsertItinerary={vi.fn()}
        onOpenGallery={vi.fn()} onOpenQualification={vi.fn()}
      />,
    );
    const toggle = screen.queryByRole('button', { name: /Lihat detail paket/ });
    if (toggle) fireEvent.click(toggle);
    expect(screen.getByText('Sudah termasuk')).toBeTruthy();
    expect(screen.queryByText('Keunggulan')).toBeNull();
  });
});

// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Badge } from './badge';
import { ConfirmDialog, Modal } from './modal';

afterEach(cleanup);

describe('Modal', () => {
  it('judul menjadi nama dialog; tombol Tutup memanggil onClose; footer tampil', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Catat follow-up" description="Interaksi" footer={<button type="button">Simpan</button>}><p>Isi</p></Modal>);
    expect(screen.getByRole('dialog', { name: 'Catat follow-up' })).toBeTruthy();
    expect(screen.getByText('Isi')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Simpan' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ConfirmDialog', () => {
  it('konfirmasi memanggil onConfirm; bisa dinonaktifkan dengan penjelasan; menampilkan error', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <ConfirmDialog open onClose={() => {}} onConfirm={onConfirm} title="Hapus paket?" confirmLabel="Hapus paket" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hapus paket' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    rerender(
      <ConfirmDialog open onClose={() => {}} onConfirm={onConfirm} title="Hapus brand?" confirmLabel="Hapus Brand" confirmDisabled error="Brand masih punya data">
        <p>Masih punya 3 prospek</p>
      </ConfirmDialog>,
    );
    expect((screen.getByRole('button', { name: 'Hapus Brand' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Masih punya 3 prospek')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Brand masih punya data');
  });
});

describe('Badge status prospek (AGENTS §3)', () => {
  it('Deal hijau solid, tahap berjalan bergaris hitam, Baru abu, Batal dicoret', () => {
    render(<><Badge value="deal" /><Badge value="offer" /><Badge value="new" /><Badge value="lose" /></>);
    expect(screen.getByText('Deal').parentElement!.className).toContain('bg-emerald-600');
    expect(screen.getByText('Ditawarkan').parentElement!.className).toContain('border-zinc-800');
    expect(screen.getByText('Baru').parentElement!.className).toContain('bg-zinc-100');
    expect(screen.getByText('Batal').parentElement!.className).toContain('line-through');
  });
});

describe('ImageLightbox', () => {
  it('klik area gelap menutup; tombol unduh untuk media chat', async () => {
    const { ImageLightbox } = await import('./image-lightbox');
    const onClose = vi.fn();
    render(<ImageLightbox open onClose={onClose} src="/uploads/a.jpg" alt="Pratinjau media" download />);
    const dialog = screen.getByRole('dialog', { name: 'Pratinjau media' });
    expect(screen.getByRole('link', { name: 'Unduh berkas' }).hasAttribute('download')).toBe(true);
    fireEvent.click(screen.getByRole('img', { name: 'Pratinjau media' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

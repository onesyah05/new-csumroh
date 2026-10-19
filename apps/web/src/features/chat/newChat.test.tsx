// @vitest-environment happy-dom
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { api } from '../../lib/api';
import { NewChatModal } from './NewChatModal';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(async () => []), post: vi.fn() }, resolveMediaUrl: (url: string) => url }));

const hana = { id: 1, name: 'Hana Tours' };
const alsha = { id: 2, name: 'Alsha Tours' };

function renderModal(brands = [hana], extra: Partial<Parameters<typeof NewChatModal>[0]> = {}) {
  const props = { open: true, onClose: vi.fn(), brands, defaultBrandId: brands[0]!.id, onStarted: vi.fn(), onOpenExisting: vi.fn(), ...extra };
  render(<QueryClientProvider client={queryClient}><NewChatModal {...props} /></QueryClientProvider>);
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.setDefaultOptions({ queries: { retry: false }, mutations: { retry: false } });
});
afterEach(() => { cleanup(); queryClient.clear(); });

describe('Modal Chat Baru', () => {
  it('akun satu brand tidak melihat pilihan brand; multi-brand melihatnya', () => {
    renderModal([hana]);
    expect(screen.queryByLabelText('Brand')).toBeNull();
    cleanup();
    renderModal([hana, alsha]);
    expect(screen.getByLabelText('Brand')).toBeTruthy();
  });

  it('tombol kirim tertutup sampai nomor, sumber, dan pesan terisi', () => {
    renderModal();
    const send = screen.getByRole('button', { name: 'Kirim & mulai chat' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('08xx atau 628xx'), { target: { value: '081234567890' } });
    fireEvent.change(screen.getByLabelText('Pesan pertama'), { target: { value: 'Assalamualaikum' } });
    expect(send.disabled).toBe(true); // sumber belum dipilih
  });

  it('nomor yang sudah ditangani CS lain menampilkan PIC dan tombol buka percakapan', async () => {
    vi.mocked(api.post).mockRejectedValue(Object.assign(new Error('Nomor ini sudah ditangani Rani.'), {
      status: 409, details: { code: 'already_handled', prospectId: 5, picName: 'Rani' },
    }));
    const props = renderModal();
    // Sumber diisi lewat nilai internal: pilih lewat Select Radix tidak praktis di happy-dom, jadi kirim langsung via form.
    fireEvent.change(screen.getByPlaceholderText('08xx atau 628xx'), { target: { value: '081234567890' } });
    fireEvent.change(screen.getByLabelText('Pesan pertama'), { target: { value: 'Assalamualaikum' } });
    const trigger = screen.getByLabelText('Sumber prospek');
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('option', { name: 'Instagram' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kirim & mulai chat' }));
    expect(await screen.findByText('Rani')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Buka percakapan' }));
    await waitFor(() => expect(props.onOpenExisting).toHaveBeenCalledWith({ prospectId: 5, brandId: 1 }));
    expect(props.onStarted).not.toHaveBeenCalled();
  });
});

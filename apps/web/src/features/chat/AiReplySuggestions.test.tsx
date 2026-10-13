// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { api } from '../../lib/api';
import { AiReplySuggestions, textSimilarity } from './AiReplySuggestions';

vi.mock('../../lib/api', () => ({ api: { post: vi.fn() } }));

const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const option = (overrides: Record<string, unknown> = {}) => ({
  approach: 'Libatkan suami', origin: 'adapted', template: 'DP {{dp_per_orang}}', text: 'DP *Rp5.000.000* per orang', status: 'ready', reasons: [], missing: [], ...overrides,
});

describe('Saran balasan AI', () => {
  it('meminta saran, menampilkan deteksi dan opsi; opsi terblokir tidak bisa dipakai', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      suggestionId: 46, source: 'ai',
      detected: { intent: 'objection', objection: 'harga', coverage: 'partial', needsInternalInfo: false, stageLabel: 'Keberatan' },
      options: [option(), option({ approach: 'Tawarkan promo', status: 'blocked', reasons: ['Tidak ada promo yang masih berlaku'], text: 'Promo {{promo}}' })],
    });
    const onReview = vi.fn();
    render(<AiReplySuggestions brandId={1} prospectId={5} onReview={onReview} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Sarankan balasan' }));
    await waitFor(() => expect(screen.getByText('Libatkan suami')).toBeTruthy());
    expect(api.post).toHaveBeenCalledWith('/ai/reply-suggestions', { prospectId: 5, brandId: 1, instruction: undefined, previousSuggestionId: undefined });
    expect(screen.getByText('Keberatan · keberatan harga · tahap Keberatan')).toBeTruthy();
    expect(screen.getByText('Belum bisa dipakai: Tidak ada promo yang masih berlaku')).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'Tinjau & gunakan' }) as HTMLButtonElement[];
    expect(buttons[1]!.disabled).toBe(true);
    fireEvent.click(buttons[0]!);
    expect(onReview).toHaveBeenCalledWith(expect.objectContaining({ approach: 'Libatkan suami' }), { suggestionId: 46, optionIndex: 0, text: 'DP *Rp5.000.000* per orang' });
  });

  it('buat ulang mengirim arahan, menandai saran lama, dan menampilkan fallback', async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({ suggestionId: 46, source: 'ai', detected: null, options: [option()] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ suggestionId: 47, source: 'fallback', detected: null, options: [option({ origin: 'bank', approach: 'Skrip harga' })] });
    render(<AiReplySuggestions brandId={1} prospectId={5} onReview={vi.fn()} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Sarankan balasan' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Buat ulang' })).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('Arahan opsional, mis. lebih singkat'), { target: { value: 'lebih singkat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buat ulang' }));
    await waitFor(() => expect(screen.getByText('Skrip harga')).toBeTruthy());
    expect(api.post).toHaveBeenCalledWith('/ai/reply-suggestions/46/feedback', { action: 'regenerated' });
    expect(api.post).toHaveBeenLastCalledWith('/ai/reply-suggestions', { prospectId: 5, brandId: 1, instruction: 'lebih singkat', previousSuggestionId: 46 });
    expect(screen.getByText(/Saran AI tidak tersedia saat ini/)).toBeTruthy();
  });

  it('menampilkan pesan error dari server', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('Batas saran AI hari ini sudah tercapai.'));
    render(<AiReplySuggestions brandId={1} prospectId={5} onReview={vi.fn()} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Sarankan balasan' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Batas saran AI hari ini sudah tercapai.'));
  });
});

describe('textSimilarity', () => {
  it('1 bila tidak diedit, turun saat diedit', () => {
    expect(textSimilarity('Boleh saya kirim rinciannya Bu?', 'Boleh saya kirim rinciannya Bu?')).toBe(1);
    expect(textSimilarity('Boleh saya kirim rinciannya Bu?', 'Boleh saya kirim rinciannya hari ini Bu?')).toBeLessThan(1);
    expect(textSimilarity('Halo', 'Terima kasih')).toBe(0);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { showFeedback, useToastStore } from './toast';

beforeEach(() => useToastStore.setState({ toasts: [] }));

describe('showFeedback', () => {
  it('pesan yang diawali "Gagal" tampil sebagai error tanpa perlu ditandai', () => {
    showFeedback('Gagal menyalin nomor rekening.');
    expect(useToastStore.getState().toasts[0]).toMatchObject({ priority: 'urgent', kind: 'feedback' });
  });

  it('pesan biasa tampil sebagai info, dan penanda error eksplisit tetap menang', () => {
    showFeedback('Nomor rekening berhasil disalin.');
    showFeedback('Data tidak lengkap', { error: true });
    showFeedback('Gagal tapi bukan error', { error: false });
    const [ok, explicit, override] = useToastStore.getState().toasts;
    expect(ok?.priority).toBe('info');
    expect(explicit?.priority).toBe('urgent');
    expect(override?.priority).toBe('info');
  });
});

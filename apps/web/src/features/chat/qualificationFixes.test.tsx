// @vitest-environment happy-dom
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { api } from '../../lib/api';
import { QualificationFields, type QualificationValue } from '../prospects/QualificationFields';
import { QualificationModal } from './QualificationModal';
import { qualificationSaveDelay } from './profileAutosave';
import { getInboxQueue, type InboxWorkFilter } from './inboxFilters';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() }, resolveMediaUrl: (url: string) => url }));

const base: QualificationValue = {
  targetMonth: '2026-12', targetMonthsExtra: '', budgetRange: '25–30 Juta', passportStatus: '', city: '',
  paxQuad: 2, paxTriple: 0, paxDouble: 0, paxInfant: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.setDefaultOptions({ queries: { retry: false }, mutations: { retry: false } });
});
afterEach(() => { cleanup(); queryClient.clear(); });

describe('jeda simpan isian kualifikasi', () => {
  it('domisili dan jumlah jamaah menunggu; pilihan disimpan segera', () => {
    expect(qualificationSaveDelay({ city: 'Solo' })).toBe(800);
    expect(qualificationSaveDelay({ paxQuad: 3 })).toBe(600);
    expect(qualificationSaveDelay({ budgetRange: '25–30 Juta' })).toBe(0);
    expect(qualificationSaveDelay({ targetMonthsExtra: '2027-01' })).toBe(0);
  });

  it('kolom domisili memberi tahu induk saat ditinggalkan agar sisa ketikan disimpan', () => {
    const onTextBlur = vi.fn();
    const onChange = vi.fn();
    render(<QualificationFields value={base} onChange={onChange} onTextBlur={onTextBlur} />);
    const input = screen.getByLabelText('Domisili');
    fireEvent.change(input, { target: { value: 'Sol' } });
    expect(onChange).toHaveBeenCalledWith({ city: 'Sol' });
    expect(onTextBlur).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onTextBlur).toHaveBeenCalledTimes(1);
  });
});

describe('filter Inbox tak dikenal', () => {
  it('diperlakukan sebagai Semua, bukan antrean follow-up', () => {
    const list = [
      { id: 1, name: 'A', status: 'contact', messages: [] },
      { id: 2, name: 'B', status: 'deal', nextFollowupDate: '2026-09-20', messages: [] },
    ];
    const result = getInboxQueue(list, { work: 'qualified' as InboxWorkFilter, owner: 'all', userId: 7, search: '', today: '2026-09-23' });
    expect(result.conversations.map((p) => p.id)).toEqual([1, 2]);
  });
});

describe('modal Kualifikasi', () => {
  const prospect = { id: 5, name: 'Jamaah Uji', status: 'contact', packageId: null, targetMonth: '2026-12', targetMonthsExtra: null, budgetRange: null, passportStatus: null, city: null, paxQuad: 0, paxTriple: 0, paxDouble: 0, paxInfant: 0 };
  const renderModal = () => render(
    <QueryClientProvider client={queryClient}>
      <QualificationModal open onClose={vi.fn()} prospect={prospect} brandId={1} packages={[]} onShowToast={vi.fn()} />
    </QueryClientProvider>,
  );

  it('mengirim hanya isian yang berubah, dan tidak mengubah domisili null menjadi string kosong', async () => {
    vi.mocked(api.patch).mockResolvedValue({ ...prospect, paxQuad: 2 } as any);
    renderModal();
    const quad = screen.getByLabelText('Jamaah Quad');
    fireEvent.change(quad, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan kualifikasi' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const [url, body] = vi.mocked(api.patch).mock.calls[0]!;
    expect(url).toBe('/prospects/5/profile');
    expect(body).toEqual({ paxQuad: 2, brandId: 1 });
  });

  it('tanpa perubahan tidak memanggil API', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Simpan kualifikasi' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Simpan kualifikasi' })).not.toBeNull());
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('domisili yang dikosongkan dikirim sebagai null', async () => {
    vi.mocked(api.patch).mockResolvedValue({ ...prospect, city: null } as any);
    render(
      <QueryClientProvider client={queryClient}>
        <QualificationModal open onClose={vi.fn()} prospect={{ ...prospect, city: 'Solo' }} brandId={1} packages={[]} onShowToast={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Domisili'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan kualifikasi' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(vi.mocked(api.patch).mock.calls[0]![1]).toEqual({ city: null, brandId: 1 });
  });
});

// @vitest-environment happy-dom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { api } from '../../lib/api';
import { ChatSidePanel, type ChatSidePanelTab } from './ChatSidePanel';
import { ChatCopilotPanel } from './ChatCopilotPanel';
import { appendDraft, appendFlyerCaption, useConversationDraft } from './profileDraft';

vi.mock('../../app/auth', () => ({ useAuth: () => ({ user: { id: 7, role: 'superadmin' } }) }));
vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() }, resolveMediaUrl: (url: string) => url }));
const packages = [{ id: 1, name: 'Paket Uji', price: 30000000, isActive: true }];
const prospect = (id = 11) => ({ id, name: `Jamaah ${id}`, brandId: 1, status: 'qualified', packageId: 1, paxQuad: 1, roomPreference: 'Quad', targetMonth: 'Desember 2026', updatedAt: '2026-09-23T00:00:00Z' });
const scripts = { categories: {
  greeting: { scripts: [{ id: 1, title: 'Salam', script: 'Assalamualaikum.' }] },
  offer: { scripts: [{ id: 2, title: 'Jadwal paket', script: 'Berangkat {{keberangkatan}}.' }] },
  objection: { scripts: [{ id: 3, title: 'Keberatan biaya', steps: [{ name: 'Tanya', text: 'Apa yang paling menjadi pertimbangan?' }, { name: 'Jawab', text: 'Mari kita sesuaikan kebutuhan.' }] }] },
} };
const insert = vi.fn();
function Workspace({ id = 11 }: { id?: number }) {
  const [tab, setTab] = useState<ChatSidePanelTab>('profile');
  return <ChatSidePanel key={id} isOpen activeTab={tab} onChangeTab={setTab} onClose={vi.fn()} prospectId={id} brandId={1} query="?brandId=1" packages={packages} onInsertText={insert} onSendFlyer={vi.fn()} onOpenPackagePicker={vi.fn()} onShowToast={vi.fn()} />;
}
function wrapper({ children }: { children: React.ReactNode }) { return <QueryClientProvider client={queryClient}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>; }
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false }, mutations: { retry: false } });
  vi.mocked(api.get).mockImplementation(async (url: string) => url.startsWith('/scripts') ? scripts : prospect(Number(url.match(/prospects\/(\d+)/)?.[1] || 11)) as any);
});
afterEach(() => { cleanup(); queryClient.clear(); });

describe('Profil dan Copilot', () => {
  it('mempertahankan draft saat pindah tab, tutup panel, dan berpindah prospek', async () => {
    const view = render(<Workspace />, { wrapper });
    fireEvent.change(await screen.findByLabelText('Nama prospek'), { target: { value: 'Draft Jamaah A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copilot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Profil' }));
    expect((screen.getByLabelText('Nama prospek') as HTMLInputElement).value).toBe('Draft Jamaah A');
    view.rerender(<Workspace id={12} />);
    await waitFor(() => expect((screen.getByLabelText('Nama prospek') as HTMLInputElement).value).toBe('Jamaah 12'));
    view.unmount();
    render(<Workspace />, { wrapper });
    expect((await screen.findByLabelText('Nama prospek') as HTMLInputElement).value).toBe('Draft Jamaah A');
  });
  it('menampilkan kegagalan simpan tanpa membuang isian dan tidak mengubah pipeline', async () => {
    vi.mocked(api.patch).mockRejectedValue(new Error('Koneksi gagal, coba lagi'));
    render(<Workspace />, { wrapper });
    fireEvent.change(await screen.findByLabelText('Nama prospek'), { target: { value: 'Nama baru' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    expect(await screen.findByText('Koneksi gagal, coba lagi')).toBeTruthy();
    expect((screen.getByLabelText('Nama prospek') as HTMLInputElement).value).toBe('Nama baru');
    const payload = vi.mocked(api.patch).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.brandId).toBe(1); expect(payload).not.toHaveProperty('status'); expect(payload).not.toHaveProperty('dealValue');
  });
  it('mencari lintas kategori dan menambahkan hanya satu langkah TGJP tanpa label internal', async () => {
    render(<ChatCopilotPanel brandId={1} stage="qualified" onInsertText={insert} onShowToast={vi.fn()} />, { wrapper });
    await screen.findByText('Jadwal paket');
    fireEvent.change(screen.getByLabelText('Cari di semua skrip'), { target: { value: 'biaya' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Tinjau langkah tanya' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tambahkan ke draft' }));
    expect(insert).toHaveBeenCalledWith('Apa yang paling menjadi pertimbangan?');
  });
  it('memblokir data belum terkonfirmasi sampai CS memperbaiki teks', async () => {
    render(<ChatCopilotPanel brandId={1} stage="qualified" onInsertText={insert} onShowToast={vi.fn()} />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Tinjau & gunakan' }));
    expect((screen.getByRole('button', { name: 'Tambahkan ke draft' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Draft balasan untuk jamaah'), { target: { value: 'Berangkat 15 Desember 2026.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tambahkan ke draft' }));
    expect(insert).toHaveBeenCalledWith('Berangkat 15 Desember 2026.');
  });
  it('menampilkan error pustaka secara terpisah dari hasil pencarian kosong', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Offline'));
    render(<ChatCopilotPanel brandId={1} onInsertText={insert} onShowToast={vi.fn()} />, { wrapper });
    expect(await screen.findByText('Skrip tidak dapat dimuat. Silakan coba lagi.')).toBeTruthy();
    expect(screen.queryByText('Tidak ada skrip yang sesuai.')).toBeNull();
  });
  it('menjaga draft composer dan callback asinkron tetap pada percakapan asal', () => {
    const hook = renderHook(({ identity }) => useConversationDraft(identity), { initialProps: { identity: 'staff:brand:A' } });
    act(() => hook.result.current[1]('Catatan A'));
    const completeSendA = hook.result.current[1];
    hook.rerender({ identity: 'staff:brand:B' });
    expect(hook.result.current[0]).toBe('');
    act(() => hook.result.current[1]('Catatan B'));
    act(() => completeSendA(''));
    expect(hook.result.current[0]).toBe('Catatan B');
    expect(appendDraft('Catatan B', 'Skrip')).toBe('Catatan B\n\nSkrip');
    expect(appendFlyerCaption('Catatan B\n\nFlyer', 'Flyer')).toBe('Catatan B\n\nFlyer');
  });
});

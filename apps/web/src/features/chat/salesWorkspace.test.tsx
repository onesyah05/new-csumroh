// @vitest-environment happy-dom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { api } from '../../lib/api';
import { ChatSidePanel, type ChatSidePanelTab } from './ChatSidePanel';
import { FinanceVerifyModal } from './FinanceVerifyModal';
import { OfficialInvoiceModal } from './OfficialInvoiceModal';
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
  vi.mocked(api.get).mockImplementation(async (url: string) => url.startsWith('/custom-requests') ? null as any : url.startsWith('/scripts') ? scripts : prospect(Number(url.match(/prospects\/(\d+)/)?.[1] || 11)) as any);
});
afterEach(() => { cleanup(); queryClient.clear(); });

describe('Profil dan Copilot', () => {
  it('simpan otomatis: hanya isian yang diubah yang dikirim, tanpa tombol Simpan', async () => {
    vi.mocked(api.patch).mockImplementation(async (_url: string, body: any) => ({ ...prospect(), ...body }) as any);
    render(<Workspace />, { wrapper });
    fireEvent.click(await screen.findByRole('tab', { name: 'Catatan' }));
    const name = await screen.findByLabelText('Nama prospek');
    fireEvent.change(name, { target: { value: 'Nama Baru' } });
    fireEvent.blur(name);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/prospects/11/profile', { name: 'Nama Baru', brandId: 1 }));
    expect(await screen.findByText('Tersimpan')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Simpan perubahan' })).toBeNull();
    // Satu baris tab; identitas jamaah tidak diulang di panel.
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent?.replace('(belum lengkap)', ''))).toEqual(['Paket', 'Kualifikasi', 'Catatan', 'Copilot', 'Riwayat']);
    // Pindah ke Copilot dan kembali: nilai tetap.
    fireEvent.click(screen.getByRole('tab', { name: 'Copilot' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Catatan' }));
    expect((screen.getByLabelText('Nama prospek') as HTMLInputElement).value).toBe('Nama Baru');
  });
  it('catatan hanya bisa ditambah (tidak diedit) dan riwayat menampilkan perubahan data', async () => {
    const logs = [
      { id: 2, actionType: 'profile_updated', title: 'Kota diubah', description: 'Kota: – → Solo', createdAt: new Date().toISOString(), user: { name: 'CS Fitri' } },
      { id: 1, actionType: 'note_added', title: 'Catatan', description: 'Minta kamar dekat lift', createdAt: new Date().toISOString(), user: { name: 'CS Fitri' } },
      { id: 0, actionType: 'message_sent', title: 'Pesan dikirim oleh CS Fitri', description: null, createdAt: new Date().toISOString(), user: { name: 'CS Fitri' } },
    ];
    vi.mocked(api.get).mockImplementation(async (url: string) => url.startsWith('/custom-requests') ? null as any : (url.includes('/logs') ? { logs, legacyNote: 'Catatan lama', legacyNoteAt: null } : url.startsWith('/scripts') ? scripts : prospect()) as any);
    vi.mocked(api.post).mockResolvedValue({} as any);
    render(<Workspace />, { wrapper });
    fireEvent.click(await screen.findByRole('tab', { name: 'Catatan' }));
    expect(await screen.findByText('Minta kamar dekat lift')).toBeTruthy();
    expect(screen.getByText('Catatan lama')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Catatan CS' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Catatan baru'), { target: { value: 'Jamaah minta ditelepon sore' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan catatan' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/prospects/11/notes', { note: 'Jamaah minta ditelepon sore', brandId: 1 }));
    fireEvent.click(screen.getByRole('tab', { name: 'Riwayat' }));
    expect(await screen.findByText('Kota: – → Solo')).toBeTruthy();
    expect(screen.queryByText('Pesan dikirim oleh CS Fitri')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Perubahan data' }));
    expect(screen.queryByText('Minta kamar dekat lift')).toBeNull();
  });
  it('data custom gagal dimuat: panel tidak berpura-pura tanpa custom dan penawaran/invoice ditahan', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.startsWith('/custom-requests')) throw Object.assign(new Error('Gagal'), { status: 500 });
      return (url.startsWith('/scripts') ? scripts : prospect()) as any;
    });
    render(<Workspace />, { wrapper });
    expect((await screen.findByRole('alert')).textContent).toContain('Layanan custom tidak dapat dimuat');
    expect(screen.queryByRole('button', { name: 'Kirim penawaran' })).toBeNull();
    expect(screen.queryByText('Kebutuhan khusus jamaah?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tindakan lainnya' }));
    expect((screen.getByRole('button', { name: /Kirim penawaran/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText('Layanan custom belum termuat').length).toBeGreaterThan(0);
  });
  it('aksi menempel pada konteksnya: tahap di atas, penawaran di bawah paket; "Tidak jadi" terpisah di menu', async () => {
    render(<Workspace />, { wrapper });
    expect(await screen.findByLabelText('Tahap 2 dari 5')).toBeTruthy();
    const offer = await screen.findByRole('button', { name: 'Kirim penawaran' });
    const packageName = screen.getByRole('heading', { name: 'Paket Uji' });
    // Tombol penawaran muncul setelah paket (konteksnya), bukan di atas tab.
    expect(packageName.compareDocumentPosition(offer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tindakan lainnya' }));
    expect(screen.getByRole('button', { name: 'Tandai tidak jadi' })).toBeTruthy();
  });
  it('gangguan jaringan: isian tetap di layar dan bisa dicoba lagi; payload tanpa status/nilai deal', async () => {
    vi.mocked(api.patch).mockRejectedValueOnce(new Error('Koneksi gagal'));
    render(<Workspace />, { wrapper });
    fireEvent.click(await screen.findByRole('tab', { name: 'Catatan' }));
    const name = await screen.findByLabelText('Nama prospek');
    fireEvent.change(name, { target: { value: 'Nama baru' } });
    fireEvent.blur(name);
    expect((await screen.findByRole('alert')).textContent).toContain('Koneksi gagal');
    expect((screen.getByLabelText('Nama prospek') as HTMLInputElement).value).toBe('Nama baru');
    const payload = vi.mocked(api.patch).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).toEqual({ name: 'Nama baru', brandId: 1 });
    vi.mocked(api.patch).mockImplementation(async (_url: string, body: any) => ({ ...prospect(), ...body }) as any);
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2));
  });
  it('ditolak aturan server (4xx): nilai kembali ke data tersimpan', async () => {
    vi.mocked(api.patch).mockRejectedValueOnce(Object.assign(new Error('Prospek sudah Terkualifikasi: Bulan keberangkatan tidak boleh dikosongkan.'), { status: 422 }));
    render(<Workspace />, { wrapper });
    fireEvent.click(await screen.findByRole('tab', { name: 'Catatan' }));
    const name = await screen.findByLabelText('Nama prospek');
    fireEvent.change(name, { target: { value: 'X' } });
    fireEvent.blur(name);
    expect((await screen.findByRole('alert')).textContent).toContain('tidak boleh dikosongkan');
    await waitFor(() => expect((screen.getByLabelText('Nama prospek') as HTMLInputElement).value).toBe('Jamaah 11'));
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


it.each(['deal', 'closed_won'])('prospek %s tidak menawarkan tindakan pembayaran lanjutan', async status => {
  vi.mocked(api.get).mockImplementation(async (url: string) => url.startsWith('/custom-requests') ? null as any : (url.startsWith('/scripts') ? scripts : { ...prospect(), status }) as any);
  render(<Workspace />, { wrapper });
  await screen.findByText(/penanganan CS selesai/i);
  expect(screen.queryByRole('button', { name: 'Tindakan lainnya' })).toBeNull();
  expect(screen.queryByRole('button', { name: /tagihan|Invoice|Unggah bukti|follow-up/i })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Copilot' }));
  expect(screen.getByText('Deal terverifikasi')).toBeTruthy();
  expect(screen.queryByLabelText('Cari di semua skrip')).toBeNull();
});

it('bukti ditolak Finance: CS melihat alasannya sampai ada bukti baru', async () => {
  const rejected = {
    ...prospect(), status: 'closing', invoiceSentAt: '2026-09-20T00:00:00Z', paymentProofUrl: null,
    proofRejections: [{ reason: 'Rekening tujuan salah', createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), rejectedBy: { name: 'Fina' } }],
  };
  vi.mocked(api.get).mockImplementation(async (url: string) => url.startsWith('/custom-requests') ? null as any : (url.startsWith('/scripts') ? scripts : rejected) as any);
  render(<Workspace />, { wrapper });
  const alert = await screen.findByText('Bukti transfer ditolak Finance');
  expect(alert.parentElement!.textContent).toContain('2 jam lalu oleh Fina');
  expect(alert.parentElement!.textContent).toContain('Alasan: Rekening tujuan salah');
});

it('modal pembayaran hanya tersedia sebelum Deal dan tidak menampilkan saldo', async () => {
  const props = { open: true, onClose: vi.fn(), prospect: { ...prospect(), invoiceAmount: 5000000 }, onShowToast: vi.fn() };
  const view = render(<FinanceVerifyModal {...props} />, { wrapper });
  expect(screen.getByLabelText('Jenis pembayaran awal')).toBeTruthy();
  expect(screen.queryByText(/Sisa tagihan|Kas terverifikasi|Sudah diverifikasi/)).toBeNull();
  view.rerender(<FinanceVerifyModal {...props} prospect={{ ...props.prospect, status: 'deal' }} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  view.rerender(<OfficialInvoiceModal {...props} prospect={{ ...props.prospect, status: 'deal' }} packages={packages} />);
  expect(screen.queryByRole('dialog')).toBeNull();
});

// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { api } from '../../lib/api';
import { AiSettingsPage, type AiSettings } from './AiSettingsPage';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));
vi.mock('../../app/toast', () => ({ showFeedback: vi.fn() }));

const settings = (overrides: Partial<AiSettings> = {}): AiSettings => ({
  enabled: false, hasApiKey: false, apiKeyHint: null, model: 'claude-haiku-5-5',
  models: [{ value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (hemat, cepat)' }, { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }],
  pilotUserIds: [], dailyLimitPerUser: 150, updatedAt: null, updatedBy: null,
  usage: { suggestions: 12, fromAi: 10, used: 6, estimatedUsd: 0.02 }, ...overrides,
});
function mockApi(data: AiSettings) {
  vi.mocked(api.get).mockImplementation(async (path: string) => (path === '/ai/settings' ? data : [
    { id: 7, name: 'Fitri', role: 'cs', isActive: true, brand: { name: 'Hana' } },
    { id: 9, name: 'Finance', role: 'finance', isActive: true, brand: null },
  ]) as any);
}
const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></MemoryRouter>;
afterEach(() => { cleanup(); vi.clearAllMocks(); queryClient.clear(); });

describe('Pengaturan Asisten AI', () => {
  it('tidak bisa diaktifkan tanpa kunci; kunci baru dikirim saat disimpan', async () => {
    mockApi(settings());
    vi.mocked(api.put).mockResolvedValue(settings({ enabled: true, hasApiKey: true, apiKeyHint: '…abcd' }));
    render(<AiSettingsPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('Pemakaian bulan ini')).toBeTruthy());
    fireEvent.click(screen.getByRole('switch', { name: 'Aktifkan saran balasan AI' }));
    expect(screen.getByRole('alert').textContent).toBe('Isi kunci API sebelum mengaktifkan.');
    expect((screen.getByRole('button', { name: 'Simpan' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('sk-ant-…'), { target: { value: 'sk-ant-api03-kunci-baru-abcd' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(vi.mocked(api.put).mock.calls[0]![1]).toEqual({ enabled: true, model: 'claude-haiku-5-5', dailyLimitPerUser: 150, pilotUserIds: [], apiKey: 'sk-ant-api03-kunci-baru-abcd' });
  });

  it('kunci tersimpan hanya tampil 4 karakter terakhir dan tidak dikirim ulang; peserta pilot hanya CS/Admin', async () => {
    mockApi(settings({ enabled: true, hasApiKey: true, apiKeyHint: '…1234' }));
    vi.mocked(api.put).mockResolvedValue(settings());
    render(<AiSettingsPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('…1234')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Hanya peserta pilot'));
    await waitFor(() => expect(screen.getByText('Fitri')).toBeTruthy());
    expect(screen.queryByText('Finance')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const body = vi.mocked(api.put).mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toMatchObject({ enabled: true, pilotUserIds: [7] });
    expect('apiKey' in body).toBe(false);
  });

  it('hapus kunci mematikan asisten dan mengirim apiKey null', async () => {
    mockApi(settings({ enabled: true, hasApiKey: true, apiKeyHint: '…1234' }));
    vi.mocked(api.put).mockResolvedValue(settings());
    render(<AiSettingsPage />, { wrapper });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hapus kunci' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Hapus kunci' }));
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(vi.mocked(api.put).mock.calls[0]![1]).toMatchObject({ enabled: false, apiKey: null });
  });
});

// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInboxNavigation } from './useInboxNavigation';
import { appendDraft, clearProfileDrafts, useConversationDraft } from './profileDraft';
import { mobileDestinations } from '../../app/MobileNavigation';

function Harness() {
  const { mobileView, sidePanelTab, setSidePanelTab, backToList } = useInboxNavigation();
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output data-testid="view">{mobileView}:{sidePanelTab ?? 'none'}</output>
    <output data-testid="url">{location.pathname}{location.search}</output>
    <button onClick={() => navigate('/inbox?brandId=1&prospectId=11', { state: { inboxList: true } })}>Pilih chat</button>
    <button onClick={() => setSidePanelTab('profile')}>Profil</button>
    <button onClick={() => setSidePanelTab('copilot')}>Copilot</button>
    <button onClick={() => setSidePanelTab(null)}>Tutup</button>
    <button onClick={backToList}>Daftar</button>
    <button onClick={() => navigate(-1)}>Back HP</button>
    <button onClick={() => navigate(1)}>Forward</button>
  </>;
}

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Workspace mobile', () => {
  it('Back HP menutup panel lalu kembali ke daftar; Forward membuka chat yang sama', async () => {
    render(<MemoryRouter initialEntries={['/inbox?brandId=1']}><Harness /></MemoryRouter>);
    fireEvent.click(screen.getByText('Pilih chat'));
    fireEvent.click(screen.getByText('Profil'));
    fireEvent.click(screen.getByText('Copilot'));
    expect(screen.getByTestId('view').textContent).toBe('chat:copilot');
    fireEvent.click(screen.getByText('Back HP'));
    await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('chat:none'));
    fireEvent.click(screen.getByText('Back HP'));
    await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('list:none'));
    fireEvent.click(screen.getByText('Forward'));
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/inbox?brandId=1&prospectId=11'));
  });
  it('tautan langsung bisa kembali ke daftar tanpa keluar dari CRM', async () => {
    render(<MemoryRouter initialEntries={['/inbox?brandId=2&phone=628111&panel=profile']}><Harness /></MemoryRouter>);
    fireEvent.click(screen.getByText('Tutup'));
    await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('chat:none'));
    fireEvent.click(screen.getByText('Daftar'));
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/inbox?brandId=2'));
  });
  it('draft pulih setelah pindah halaman, terpisah per staf/brand/prospek, dan dibersihkan saat logout', () => {
    const first = renderHook(() => useConversationDraft('7:1:11'));
    act(() => first.result.current[1]('Draft saya'));
    first.unmount();
    const second = renderHook(({ identity }) => useConversationDraft(identity), { initialProps: { identity: '7:1:11' } });
    expect(second.result.current[0]).toBe('Draft saya');
    act(() => second.result.current[1](text => appendDraft(text, 'Pertanyaan')));
    second.rerender({ identity: '8:1:11' });
    expect(second.result.current[0]).toBe('');
    second.rerender({ identity: '7:2:11' });
    expect(second.result.current[0]).toBe('');
    second.unmount();
    const third = renderHook(() => useConversationDraft('7:1:11'));
    expect(third.result.current[0]).toBe('Draft saya\n\nPertanyaan');
    third.unmount(); clearProfileDrafts();
    expect(renderHook(() => useConversationDraft('7:1:11')).result.current[0]).toBe('');
  });
  it('navigasi Finance memprioritaskan verifikasi; Tim LA tidak diberi akses chat/prospek', () => {
    expect(mobileDestinations('finance').map(item => item.to)).toEqual(['/', '/inbox', '/verifikasi']);
    expect(mobileDestinations('cs').map(item => item.to)).toEqual(['/', '/inbox', '/pipeline']);
    expect(mobileDestinations('product').map(item => item.to)).toEqual(['/layanan-custom', '/pengaturan/notifikasi']);
  });
});

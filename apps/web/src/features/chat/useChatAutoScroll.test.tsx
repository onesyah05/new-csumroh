// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatAutoScroll } from './useChatAutoScroll';

let height: number;
let top: number;
let resize: () => void;
let isFollowing: () => boolean;

function Timeline({ identity = 'brand:prospect', messages }: { identity?: string; messages?: unknown }) {
  const scroll = useChatAutoScroll(identity, messages);
  const { timelineRef, contentRef, showScrollToLatest, scrollToLatest } = scroll;
  isFollowing = scroll.isFollowing;
  return <>
    <div data-testid="timeline" ref={node => {
      timelineRef.current = node;
      if (node) Object.defineProperties(node, {
        scrollHeight: { configurable: true, get: () => height },
        clientHeight: { configurable: true, get: () => 500 },
        scrollTop: { configurable: true, get: () => top, set: value => { top = Math.max(0, Math.min(value, height - 500)); } },
      });
    }}><div ref={contentRef} /></div>
    {showScrollToLatest && <button onClick={scrollToLatest}>Ke pesan terbaru</button>}
    {/* Mensimulasikan kirim pesan: InboxPage memanggil scrollToLatest saat dan setelah pesan dikirim. */}
    <button type="button" data-testid="kirim" onClick={scrollToLatest}>Kirim</button>
  </>;
}

beforeEach(() => {
  height = 2000;
  top = 0;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Navigasi ke pesan terbaru', () => {
  it('menunggu pesan pertama, lalu membuka bagian akhir tanpa tombol tambahan', () => {
    const view = render(<Timeline />);
    expect(top).toBe(0);
    view.rerender(<Timeline messages={['pertama']} />);
    expect(top).toBe(1500);
    expect(screen.queryByRole('button', { name: 'Ke pesan terbaru' })).toBeNull();
  });

  it('menjaga posisi baca saat ada pesan baru, lalu kembali ke akhir setelah tombol diklik', () => {
    const view = render(<Timeline messages={['lama']} />);
    top = 200;
    fireEvent.scroll(screen.getByTestId('timeline'));
    expect(screen.getByRole('button', { name: 'Ke pesan terbaru' })).toBeTruthy();
    height = 2500;
    view.rerender(<Timeline messages={['lama', 'baru']} />);
    expect(top).toBe(200);
    fireEvent.click(screen.getByRole('button', { name: 'Ke pesan terbaru' }));
    expect(top).toBe(2000);
    expect(screen.queryByRole('button', { name: 'Ke pesan terbaru' })).toBeNull();
    // Media yang selesai dimuat sesudah klik tetap diikuti sampai bagian akhir.
    height = 2800;
    act(() => resize());
    expect(top).toBe(2300);
  });

  it('mengirim pesan saat membaca riwayat langsung mengikuti pesan baru ke bagian akhir', () => {
    const view = render(<Timeline messages={['lama']} />);
    top = 200;
    fireEvent.scroll(screen.getByTestId('timeline'));
    fireEvent.click(screen.getByTestId('kirim'));
    // Pesan yang baru terkirim tiba sesudahnya dan menambah tinggi: tampilan harus ikut ke akhir, bukan tertahan di 200.
    height = 2600;
    view.rerender(<Timeline messages={['lama', 'baru']} />);
    expect(top).toBe(2100);
    expect(screen.queryByRole('button', { name: 'Ke pesan terbaru' })).toBeNull();
  });

  it('isFollowing: false saat membaca riwayat, true lagi setelah kembali ke pesan terbaru', () => {
    render(<Timeline messages={['lama']} />);
    expect(isFollowing()).toBe(true);
    top = 200;
    fireEvent.scroll(screen.getByTestId('timeline'));
    expect(isFollowing()).toBe(false);
    fireEvent.click(screen.getByTestId('kirim'));
    expect(isFollowing()).toBe(true);
  });

  it('menyembunyikan tombol saat kembali ke bawah secara manual', () => {
    render(<Timeline messages={[]} />);
    top = 100;
    fireEvent.scroll(screen.getByTestId('timeline'));
    expect(screen.queryByRole('button', { name: 'Ke pesan terbaru' })).not.toBeNull();
    top = 1500;
    fireEvent.scroll(screen.getByTestId('timeline'));
    expect(screen.queryByRole('button', { name: 'Ke pesan terbaru' })).toBeNull();
  });

  it('mengatur ulang posisi dan tombol ketika pindah percakapan', () => {
    const view = render(<Timeline messages={['a']} />);
    top = 100;
    fireEvent.scroll(screen.getByTestId('timeline'));
    view.rerender(<Timeline identity="brand:lain" messages={['b']} />);
    expect(top).toBe(1500);
    expect(screen.queryByRole('button', { name: 'Ke pesan terbaru' })).toBeNull();
  });

  it('tidak menarik pembaca dari riwayat saat ukuran media berubah', () => {
    render(<Timeline messages={['a']} />);
    top = 200;
    fireEvent.scroll(screen.getByTestId('timeline'));
    height = 2600;
    act(() => resize());
    expect(top).toBe(200);
    expect(screen.queryByRole('button', { name: 'Ke pesan terbaru' })).not.toBeNull();
  });
});

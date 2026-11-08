// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKeepListPosition } from './useKeepListPosition';

const ROW = 72;
const VIEW = 300;

// Geometri tiruan: baris setinggi 72 px berurutan; kotak daftar 300 px; scrollTop disimpan sendiri.
function List({ ids }: { ids: number[] }) {
  const { nodeRef } = useKeepListPosition([ids]);
  return (
    <div data-testid="list" ref={nodeRef}>
      {ids.map((id) => <div key={id} data-row-id={id}>Jamaah {id}</div>)}
    </div>
  );
}

let list: HTMLElement;
let scrollTop = 0;
const original = Element.prototype.getBoundingClientRect;

beforeEach(() => {
  scrollTop = 0;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this === list) return { top: 0, bottom: VIEW, left: 0, right: 300, width: 300, height: VIEW } as DOMRect;
    const index = [...(this.parentElement?.children ?? [])].indexOf(this);
    const top = index * ROW - scrollTop;
    return { top, bottom: top + ROW, left: 0, right: 300, width: 300, height: ROW } as DOMRect;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Element.prototype.getBoundingClientRect = original;
});

function mount(ids: number[]) {
  const view = render(<List ids={ids} />);
  list = view.getByTestId('list');
  Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => VIEW });
  Object.defineProperty(list, 'scrollTop', { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } });
  return view;
}

async function scrollTo(value: number) {
  scrollTop = value;
  await act(async () => undefined);
}

const ids = Array.from({ length: 30 }, (_, i) => i);
const moveToTop = (id: number) => [id, ...ids.filter((x) => x !== id)];

describe('Daftar chat tetap di posisinya setelah urutan berubah', () => {
  it('chat yang dibalas pindah ke atas: daftar tidak ikut naik, baris teratas tetap di tempatnya', async () => {
    const view = mount(ids);
    await scrollTo(10 * ROW); // terlihat Jamaah 10..14
    view.rerender(<List ids={moveToTop(12)} />);
    // Jamaah 10 sekarang di indeks 11: digeser satu baris agar tetap di atas, bukan kembali ke 0.
    expect(scrollTop).toBe(11 * ROW);
  });

  it('chat teratas yang terlihat dibalas: baris di bawahnya tetap di tempat', async () => {
    const view = mount(ids);
    await scrollTo(10 * ROW);
    view.rerender(<List ids={moveToTop(10)} />);
    expect(scrollTop).toBe(10 * ROW);
  });

  it('chat baru masuk di atas saat menggulir ke bawah: daftar tidak bergeser', async () => {
    const view = mount(ids);
    await scrollTo(10 * ROW);
    view.rerender(<List ids={[99, ...ids]} />);
    expect(scrollTop).toBe(11 * ROW);
  });

  it('sedang di paling atas: tetap di atas agar chat baru langsung terlihat', async () => {
    const view = mount(ids);
    await scrollTo(0);
    view.rerender(<List ids={[99, ...ids]} />);
    expect(scrollTop).toBe(0);
  });
});

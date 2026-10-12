import { describe, expect, it } from 'vitest';
import { splitLinks } from './linkify';

describe('splitLinks', () => {
  it('membuat URL bisa diklik dan membuang tanda baca penutup', () => {
    expect(splitLinks('Lihat di https://demo.klikumroh.id/ref/MANFB4RC?to=%2Fpaket%2F6.')).toEqual([
      { text: 'Lihat di ' },
      { text: 'https://demo.klikumroh.id/ref/MANFB4RC?to=%2Fpaket%2F6', href: 'https://demo.klikumroh.id/ref/MANFB4RC?to=%2Fpaket%2F6' },
      { text: '.' },
    ]);
  });

  it('www tanpa skema mendapat https; teks tanpa tautan tetap utuh', () => {
    expect(splitLinks('buka www.azhan.id sekarang')[1]).toEqual({ text: 'www.azhan.id', href: 'https://www.azhan.id' });
    expect(splitLinks('tidak ada tautan')).toEqual([{ text: 'tidak ada tautan' }]);
  });

  it('skema selain http/https tidak dijadikan tautan', () => {
    expect(splitLinks('javascript:alert(1) dan ftp://x.id')).toEqual([{ text: 'javascript:alert(1) dan ftp://x.id' }]);
  });

  it('banyak tautan dalam satu pesan', () => {
    const hrefs = splitLinks('a http://a.id b (https://b.id)').filter((p) => p.href).map((p) => p.href);
    expect(hrefs).toEqual(['http://a.id', 'https://b.id']);
  });
});

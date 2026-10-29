import { describe, expect, it } from 'vitest';
import { splitByTerm } from './messageSearch';

describe('splitByTerm', () => {
  it('menandai setiap kemunculan kata tanpa membedakan huruf besar/kecil dan mempertahankan teks asli', () => {
    expect(splitByTerm('Desember atau desember', 'DESEMBER')).toEqual([
      { text: 'Desember', match: true },
      { text: ' atau ', match: false },
      { text: 'desember', match: true },
    ]);
  });

  it('tanpa kata kunci atau tanpa kecocokan mengembalikan satu bagian biasa', () => {
    expect(splitByTerm('Halo', '')).toEqual([{ text: 'Halo', match: false }]);
    expect(splitByTerm('Halo', 'xyz')).toEqual([{ text: 'Halo', match: false }]);
  });
});

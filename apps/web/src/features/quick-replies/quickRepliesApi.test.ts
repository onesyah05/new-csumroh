import { describe, expect, it } from 'vitest';
import { matchQuickReplies, slashKey, slashQueryAt, unresolvedTokens, type QuickReply } from './quickRepliesApi';

const reply = (id: number, title: string, shortcut: string | null, body = 'isi'): QuickReply => ({
  id, brandId: 1, scope: 'brand', ownerId: 1, title, shortcut, body, text: body, missing: [],
});

describe('slashQueryAt', () => {
  it('mengenali "/" di awal pesan dan setelah spasi atau baris baru', () => {
    expect(slashQueryAt('/ha', 3)).toEqual({ start: 0, end: 3, query: 'ha' });
    expect(slashQueryAt('Halo kak /pa', 12)).toEqual({ start: 9, end: 12, query: 'pa' });
    expect(slashQueryAt('baris satu\n/', 12)).toEqual({ start: 11, end: 12, query: '' });
  });

  it('bukan token bila "/" di tengah kata, URL, atau sudah ada spasi setelah query', () => {
    expect(slashQueryAt('http://x.id/abc', 15)).toBeNull();
    expect(slashQueryAt('a/b', 3)).toBeNull();
    expect(slashQueryAt('/halo kak', 9)).toBeNull();
  });

  it('memakai posisi kursor, bukan akhir teks', () => {
    expect(slashQueryAt('/ha kak', 3)).toEqual({ start: 0, end: 3, query: 'ha' });
  });
});

describe('matchQuickReplies', () => {
  const list = [
    reply(1, 'Rekening resmi', 'rek', 'Transfer ke rekening BCA'),
    reply(2, 'Halo pagi', 'halo'),
    reply(3, 'Jadwal keberangkatan', null, 'Cek halo jadwal'),
    reply(4, 'Terima kasih', 'makasih'),
  ];

  it('tanpa query menampilkan daftar apa adanya', () => {
    expect(matchQuickReplies(list, '').map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });

  it('urut: pintasan diawali query, judul diawali, memuat, isi', () => {
    expect(matchQuickReplies(list, 'ha').map((r) => r.id)).toEqual([2, 3]);
    expect(matchQuickReplies(list, 'rek').map((r) => r.id)).toEqual([1]);
    expect(matchQuickReplies(list, 'zzz')).toEqual([]);
  });

  it('batas 8 hasil', () => {
    const many = Array.from({ length: 12 }, (_, i) => reply(i + 1, 'Item ' + i, null));
    expect(matchQuickReplies(many, '')).toHaveLength(8);
  });
});

describe('unresolvedTokens', () => {
  it('mendeteksi token {{x}} yang tersisa tanpa duplikat', () => {
    expect(unresolvedTokens('Halo {{nama}}, paket {{paket}} dan {{PAKET}}')).toEqual(['nama', 'paket']);
    expect(unresolvedTokens('Halo Ibu Aisyah')).toEqual([]);
  });
});

describe('slashKey', () => {
  it('berubah bila posisi atau query berubah (Esc hanya menutup token yang sama)', () => {
    expect(slashKey({ start: 0, end: 3, query: 'ha' })).not.toBe(slashKey({ start: 0, end: 4, query: 'hal' }));
    expect(slashKey({ start: 4, end: 7, query: 'ha' })).not.toBe(slashKey({ start: 0, end: 3, query: 'ha' }));
  });
});

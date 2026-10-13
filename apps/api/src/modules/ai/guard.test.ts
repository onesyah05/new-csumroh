import { describe, expect, it } from 'vitest';
import { redactPii, templateViolations } from './guard.js';

describe('redactPii', () => {
  it('menyamarkan nomor telepon, email, NIK, rekening, dan paspor', () => {
    const text = 'WA saya 0812-3456-7890 atau +62 812 3456 7890, email ibu@contoh.id, NIK 3201234567890001, rek 1234 5678 90, paspor C1234567';
    const out = redactPii(text);
    expect(out).not.toMatch(/0812|3456|ibu@contoh|3201234567890001|1234 5678|C1234567/);
    expect(out.match(/\[disamarkan\]/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it('angka pendek percakapan tetap utuh', () => {
    expect(redactPii('Kami 4 orang, rencana Maret, 2 dewasa 1 anak')).toBe('Kami 4 orang, rencana Maret, 2 dewasa 1 anak');
  });
});

describe('templateViolations', () => {
  it('meloloskan template yang hanya memakai token dan angka kecil', () => {
    expect(templateViolations('Untuk 2 orang, DP-nya {{dp_per_orang}} per orang di *{{paket}}*. Boleh saya kirim rinciannya?')).toEqual([]);
  });

  it('menolak nominal, tanggal, tahun, nomor panjang, dan tautan yang ditulis langsung', () => {
    expect(templateViolations('DP cukup Rp5.000.000 saja')).toContain('menulis nominal Rupiah');
    expect(templateViolations('Harganya 35 juta per orang')).toContain('menulis nominal uang');
    expect(templateViolations('Total 35.000.000')).toContain('menulis angka nominal');
    expect(templateViolations('Berangkat 14 Februari ya')).toContain('menulis tanggal');
    expect(templateViolations('Berangkat 14/02 ya')).toContain('menulis tanggal');
    expect(templateViolations('Musim 2027 ramai')).toContain('menulis tahun');
    expect(templateViolations('Transfer ke 1234567890')).toContain('menulis nomor telepon atau rekening');
    expect(templateViolations('Cek di https://contoh.id')).toContain('menulis tautan');
  });

  it('token daftar (harga per kamar, fasilitas) harus di baris sendiri', () => {
    expect(templateViolations('Rincian harga per kamar:\n{{harga_kamar}}\nMau saya bantu hitung?')).toEqual([]);
    expect(templateViolations('Mau saya kirim rincian *{{harga_kamar}}* untuk dipertimbangkan?')).toContain('token daftar tidak di baris sendiri');
  });

  it('angka dan tanggal yang sudah ada di riwayat chat boleh dipakai ulang; yang tidak ada tetap ditolak', () => {
    const history = 'Keberangkatan 19 Desember 2026 harga (Double) 38.499.000\n19 ato 21 Dec';
    expect(templateViolations('Kak, mau yang 19 atau 21 Desember?', { history })).toEqual([]);
    expect(templateViolations('Yang Rp38.499.000 itu sudah all in ya kak', { history })).toEqual([]);
    expect(templateViolations('Kalau yang 28 Desember bagaimana kak?', { history })).toContain('menulis tanggal');
    expect(templateViolations('Harganya jadi Rp36.000.000 kak', { history })).toContain('menulis nominal Rupiah');
  });

  it('angka dari riwayat hanya meloloskan fakta yang sama (nilai + satuan, hari + bulan), bukan angkanya saja', () => {
    const history = 'Keberangkatan 25 Desember 2026, start di harga 34.499jt, paket 38.499.000';
    // Celah lama: "25" dan "2026" dari riwayat meloloskan nominal karangan.
    expect(templateViolations('DP-nya cukup Rp25 juta kak', { history })).toContain('menulis nominal Rupiah');
    expect(templateViolations('Harganya 25 juta saja kak', { history })).toContain('menulis nominal uang');
    expect(templateViolations('Paket 2026 jadi Rp30.000.000 kak', { history })).toContain('menulis nominal Rupiah');
    // Nilai yang sama walau ditulis beda format tetap lolos.
    expect(templateViolations('Yang mulai Rp34.499.000 itu kak?', { history })).toEqual([]);
    expect(templateViolations('Yang Rp38.499.000 sudah all in kak', { history })).toEqual([]);
    expect(templateViolations('Mau ambil yang 25 Des 2026 kak?', { history })).toEqual([]);
    expect(templateViolations('Kalau yang 38 juta bagaimana kak?', { history })).toContain('menulis nominal uang');
    expect(templateViolations('Mau yang 26 Desember kak?', { history })).toContain('menulis tanggal');
    expect(templateViolations('Kalau 2027 bagaimana kak?', { history })).toContain('menulis tahun');
  });

  it('alamat/Maps di baris sendiri, tidak diulang bila sudah dikirim, dan tanpa tanda tangan', () => {
    expect(templateViolations('Baik kak, ini lokasinya:\nAlamat: {{alamat_kantor}}\n{{link_maps}}')).toEqual([]);
    expect(templateViolations('Kantor kami di {{alamat_kantor}}, kapan mau mampir kak?')).toContain('alamat atau tautan Maps tidak di baris sendiri');
    expect(templateViolations('Ini lokasinya:\n{{link_maps}}', { blockedTokens: ['link_maps'] })).toContain('{{link_maps}} sudah dikirim CS, jangan diulang');
    expect(templateViolations('Ditunggu kabarnya kak.\nSalam, Zaky - Alsha Tours')).toContain('memakai tanda tangan penutup');
    expect(templateViolations('Kak, kalau mau datang Bapak/Ibu kabari ya')).toContain('mencampur sapaan "kak" dan "Bapak/Ibu"');
    expect(templateViolations('Kak Erni, jadwal mana yang cocok untuk Ibu?')).toContain('mencampur sapaan "kak" dan "Bapak/Ibu"');
    expect(templateViolations('Kantor kami di ibu kota, kak')).toEqual([]);
  });

  it('menolak token di luar kontrak dan teks kosong atau terlalu panjang', () => {
    expect(templateViolations('Harga {{harga_spesial}}')).toContain('token tidak dikenal {{harga_spesial}}');
    expect(templateViolations('   ')).toEqual(['teks kosong']);
    expect(templateViolations('a'.repeat(701))).toContain('lebih dari 700 karakter');
  });
});

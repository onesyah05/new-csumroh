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

  it('menolak token di luar kontrak dan teks kosong atau terlalu panjang', () => {
    expect(templateViolations('Harga {{harga_spesial}}')).toContain('token tidak dikenal {{harga_spesial}}');
    expect(templateViolations('   ')).toEqual(['teks kosong']);
    expect(templateViolations('a'.repeat(701))).toContain('lebih dari 700 karakter');
  });
});

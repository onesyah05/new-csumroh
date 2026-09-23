const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Satu sel CSV. Teks yang diawali = + - @ TAB CR dianggap formula oleh Excel/Sheets; nama kontak
 * WhatsApp dikendalikan pihak luar, jadi sel seperti itu diberi awalan ' agar tampil sebagai teks.
 * Angka asli (number) tidak diubah.
 */
export function csvCell(value: unknown) {
  if (value === null || value === undefined) return '""';
  const text = String(value);
  const safe = typeof value !== 'number' && FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** CSV dengan BOM UTF-8 agar huruf non-ASCII terbaca benar saat dibuka di Excel. */
export function toCsv(rows: unknown[][]) {
  return `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

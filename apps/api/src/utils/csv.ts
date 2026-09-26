// Sel diawali = + - @ TAB CR dianggap formula oleh Excel/Sheets; teks dari pihak luar (nama kontak WhatsApp)
// diberi awalan ' agar tampil sebagai teks. Angka asli tidak diubah.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: unknown) {
  if (value === null || value === undefined) return '""';
  const text = String(value);
  const safe = typeof value !== 'number' && FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** CSV dengan BOM UTF-8 agar huruf non-ASCII terbaca benar di Excel. */
export function toCsv(header: string[], rows: unknown[][]) {
  return `﻿${[header.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\r\n')}`;
}

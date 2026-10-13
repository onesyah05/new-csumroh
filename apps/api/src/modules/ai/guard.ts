import { SCRIPT_VARIABLES } from '@csumroh/shared-types';
import { TOKEN_INFO } from '../scripts/context.js';

/**
 * Penyamaran data pribadi sebelum chat dikirim ke provider AI (spec bagian 7). Urutan penting: email dan nomor
 * telepon lebih dulu, lalu deret angka panjang (NIK, rekening), lalu pola paspor.
 */
const MASK = '[disamarkan]';
export function redactPii(text: string) {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, MASK)
    .replace(/(?:\+?62|0)[\s-]?8[\d\s-]{7,14}\d/g, MASK)
    // Deret angka panjang (NIK 16 digit, rekening) walau dipisah spasi/titik; angka pendek seperti "2 orang" tetap.
    .replace(/\d[\d\s.-]{6,}\d/g, (match) => (match.replace(/\D/g, '').length >= 8 ? MASK : match))
    .replace(/\b[A-Z]{1,2}\s?\d{6,8}\b/g, MASK);
}

/** Token yang boleh dipakai AI: kontrak script (SCRIPT_VARIABLES) ditambah token brand dari konteks pustaka. */
export const ALLOWED_TOKENS = new Set<string>([...SCRIPT_VARIABLES, ...Object.keys(TOKEN_INFO)]);

const TOKEN = /\{\{([a-z0-9_]+)\}\}/gi;
const MONTH = '(jan|feb|mar|apr|mei|may|jun|jul|agu|agt|aug|sep|okt|oct|nov|des|dec)[a-z]*';
/** Pola fakta yang tidak boleh ditulis AI sendiri (spec bagian 8). Fakta hanya lewat token. */
const FORBIDDEN: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bRp\.?\s?\d/i, reason: 'menulis nominal Rupiah' },
  { pattern: /\b\d+([.,]\d+)?\s?(rb|ribu|jt|juta|k|m)\b/i, reason: 'menulis nominal uang' },
  { pattern: /\b\d{1,3}([.,]\d{3})+\b/, reason: 'menulis angka nominal' },
  { pattern: new RegExp(`\\b\\d{1,2}\\s+${MONTH}\\b`, 'i'), reason: 'menulis tanggal' },
  { pattern: /\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b/, reason: 'menulis tanggal' },
  { pattern: /\b20\d{2}\b/, reason: 'menulis tahun' },
  { pattern: /\d{8,}/, reason: 'menulis nomor telepon atau rekening' },
  { pattern: /https?:\/\/|www\./i, reason: 'menulis tautan' },
];
export const MAX_OPTION_LENGTH = 700;
/** Token yang terisi daftar berbutir (beberapa baris): harus berdiri di baris sendiri agar format WhatsApp tidak rusak. */
export const LIST_TOKENS = ['harga_kamar', 'fasilitas_termasuk', 'fasilitas_tidak_termasuk'];

/** Pelanggaran satu template opsi; kosong berarti lolos. */
export function templateViolations(template: string) {
  const violations: string[] = [];
  const text = template.trim();
  if (!text) return ['teks kosong'];
  if (text.length > MAX_OPTION_LENGTH) violations.push(`lebih dari ${MAX_OPTION_LENGTH} karakter`);
  for (const match of text.matchAll(TOKEN)) {
    const token = match[1]!.toLowerCase();
    if (!ALLOWED_TOKENS.has(token)) violations.push(`token tidak dikenal {{${token}}}`);
  }
  for (const line of text.split('\n')) {
    const inline = LIST_TOKENS.some((token) => line.includes(`{{${token}}}`) && line.trim() !== `{{${token}}}`);
    if (inline) violations.push('token daftar tidak di baris sendiri');
  }
  const withoutTokens = text.replace(TOKEN, '');
  for (const rule of FORBIDDEN) if (rule.pattern.test(withoutTokens)) violations.push(rule.reason);
  return [...new Set(violations)];
}

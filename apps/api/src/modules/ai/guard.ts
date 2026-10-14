import { SCRIPT_VARIABLES } from '@csumroh/shared-types';
import { TOKEN_INFO } from '../scripts/context.js';

/**
 * Penyamaran data pribadi sebelum chat dikirim ke provider AI (spec bagian 7). Urutan penting: email dan nomor
 * telepon lebih dulu, lalu deret angka panjang (NIK, rekening), lalu pola paspor.
 */
const MASK = '[disamarkan]';
export function redactPii(text: string, options: { addresses?: boolean } = {}) {
  const masked = text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, MASK)
    .replace(/(?:\+?62|0)[\s-]?8[\d\s-]{7,14}\d/g, MASK)
    // Deret angka panjang (NIK 16 digit, rekening) walau dipisah spasi/titik; angka pendek seperti "2 orang" tetap.
    .replace(/\d[\d\s.-]{6,}\d/g, (match) => (match.replace(/\D/g, '').length >= 8 ? MASK : match))
    .replace(/\b[A-Z]{1,2}\s?\d{6,8}\b/g, MASK);
  if (options.addresses === false) return masked;
  // Alamat jalan dan wilayah administratif (Jl./Gang, RT/RW, Kel./Kec./Desa): nama dan nomornya ikut disamarkan.
  // Dimatikan untuk pesan CS sendiri: alamat kantor brand bukan data pribadi dan dipakai mendeteksi alamat yang sudah terkirim.
  return masked
    .replace(/\b(?:jl|jln|jalan|gg|gang)\.?\s+[^\n,;]{3,60}/gi, MASK)
    .replace(/\brt\.?\s?\d{1,3}\s?[/\\-]?\s?(?:rw\.?\s?\d{1,3})?/gi, MASK)
    .replace(/\b(?:kel|kelurahan|kec|kecamatan|desa)\.?\s+[^\n,;.]{2,40}/gi, MASK);
}

/** Token yang boleh dipakai AI: kontrak script (SCRIPT_VARIABLES) ditambah token brand dari konteks pustaka. */
export const ALLOWED_TOKENS = new Set<string>([...SCRIPT_VARIABLES, ...Object.keys(TOKEN_INFO)]);

const TOKEN = /\{\{([a-z0-9_]+)\}\}/gi;
/** Selalu ditolak, walau ada di riwayat: nomor panjang (telepon/rekening) dan tautan hanya lewat token. */
const FORBIDDEN: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\d{8,}/, reason: 'menulis nomor telepon atau rekening' },
  { pattern: /https?:\/\/|www\./i, reason: 'menulis tautan' },
];

const MONTHS: Record<string, string> = {
  jan: 'jan', feb: 'feb', mar: 'mar', apr: 'apr', mei: 'mei', may: 'mei', jun: 'jun', jul: 'jul',
  agu: 'agu', agt: 'agu', aug: 'agu', sep: 'sep', okt: 'okt', oct: 'okt', nov: 'nov', des: 'des', dec: 'des',
};
const UNIT: Record<string, number> = { rb: 1e3, ribu: 1e3, k: 1e3, jt: 1e6, juta: 1e6, m: 1e6 };
const MONEY = /(rp\.?\s?)?(\d+(?:[.,]\d+)*)\s?(rb|ribu|k|jt|juta|m)?\b/gi;
const DAY_MONTH = /\b(\d{1,2})\s+(jan|feb|mar|apr|mei|may|jun|jul|agu|agt|aug|sep|okt|oct|nov|des|dec)[a-z]*\b/gi;
const NUMERIC_DATE = /\b(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?\b/g;
const YEAR = /\b20\d{2}\b/g;

type Fact = { key: string; reason: string };
/**
 * Fakta yang tertulis di teks: nominal (nilai beserta satuannya), tanggal (hari + bulan), dan tahun. Dipakai untuk
 * template dan riwayat chat dengan aturan yang sama: fakta di template hanya boleh bila fakta yang SAMA ada di riwayat
 * (mis. "25 Desember" di chat tidak meloloskan "Rp25 juta").
 */
function factsIn(text: string): Fact[] {
  const facts: Fact[] = [];
  for (const [, prefix, number, unit] of text.matchAll(MONEY)) {
    const grouped = /^\d{1,3}([.,]\d{3})+$/.test(number!);
    if (!prefix && !unit && !grouped) continue; // angka biasa ("2 orang", "9 hari") bukan nominal
    const separators = (number!.match(/[.,]/g) ?? []).length;
    // "34.499jt" = 34,499 juta (satu pemisah + satuan = desimal); "38.499.000" = angka penuh.
    const base = unit && separators === 1 ? Number(number!.replace(',', '.')) : Number(number!.replace(/[.,]/g, ''));
    const value = Math.round(base * (unit ? UNIT[unit.toLowerCase()]! : 1));
    facts.push({ key: `uang:${value}`, reason: prefix ? 'menulis nominal Rupiah' : unit ? 'menulis nominal uang' : 'menulis angka nominal' });
  }
  for (const [, day, month] of text.matchAll(DAY_MONTH)) facts.push({ key: `tanggal:${Number(day)}-${MONTHS[month!.toLowerCase()]}`, reason: 'menulis tanggal' });
  for (const [, day, month] of text.matchAll(NUMERIC_DATE)) facts.push({ key: `tanggal:${Number(day)}/${Number(month)}`, reason: 'menulis tanggal' });
  for (const [year] of text.matchAll(YEAR)) facts.push({ key: `tahun:${year}`, reason: 'menulis tahun' });
  return facts;
}
export const MAX_OPTION_LENGTH = 700;
/** Token yang terisi daftar berbutir (beberapa baris): harus berdiri di baris sendiri agar format WhatsApp tidak rusak. */
export const LIST_TOKENS = ['harga_kamar', 'fasilitas_termasuk', 'fasilitas_tidak_termasuk'];
/** Alamat dan tautan Maps panjang: di baris sendiri, boleh diawali label pendek ("Alamat:"). */
export const LINE_TOKENS = ['alamat_kantor', 'link_maps'];

export type TemplateRules = {
  /** Teks riwayat chat (sudah disamarkan): angka/tanggal yang sudah ada di sini boleh dipakai ulang. */
  history?: string;
  /** Token yang tidak boleh dipakai di permintaan ini (mis. alamat yang baru saja dikirim CS). */
  blockedTokens?: string[];
};

/** Pelanggaran satu template opsi; kosong berarti lolos. */
export function templateViolations(template: string, rules: TemplateRules = {}) {
  const violations: string[] = [];
  const text = template.trim();
  if (!text) return ['teks kosong'];
  if (text.length > MAX_OPTION_LENGTH) violations.push(`lebih dari ${MAX_OPTION_LENGTH} karakter`);
  for (const match of text.matchAll(TOKEN)) {
    const token = match[1]!.toLowerCase();
    if (!ALLOWED_TOKENS.has(token)) violations.push(`token tidak dikenal {{${token}}}`);
    else if (rules.blockedTokens?.includes(token)) violations.push(`{{${token}}} sudah dikirim CS, jangan diulang`);
  }
  for (const line of text.split('\n')) {
    const inline = LIST_TOKENS.some((token) => line.includes(`{{${token}}}`) && line.trim() !== `{{${token}}}`);
    if (inline) violations.push('token daftar tidak di baris sendiri');
    const crowded = LINE_TOKENS.some((token) => line.includes(`{{${token}}}`) && !/^([\p{L} ]{0,20}:)?$/u.test(line.replace(`{{${token}}}`, '').trim()));
    if (crowded) violations.push('alamat atau tautan Maps tidak di baris sendiri');
  }
  if (/(^|\n)\s*(salam|hormat kami|regards)\b/i.test(text)) violations.push('memakai tanda tangan penutup');
  // Sapaan formal ditulis kapital ("Ibu", "Bapak/Ibu", "Bu"); huruf kecil seperti "ibu kota" tidak dihitung.
  if (/\bkak(ak)?\b/i.test(text) && /\b(Bapak|Ibu|Pak|Bu)\b/.test(text)) violations.push('mencampur sapaan "kak" dan "Bapak/Ibu"');
  const withoutTokens = text.replace(TOKEN, '');
  for (const rule of FORBIDDEN) if (rule.pattern.test(withoutTokens)) violations.push(rule.reason);
  // Nominal/tanggal/tahun hanya boleh bila fakta yang sama (nilai + satuan, hari + bulan) sudah tertulis di riwayat.
  const known = new Set(factsIn(rules.history ?? '').map((fact) => fact.key));
  for (const fact of factsIn(withoutTokens)) if (!known.has(fact.key)) violations.push(fact.reason);
  return [...new Set(violations)];
}

/**
 * Kontrak token script (audit S03). Token berasal dari data server (brand, CS, paket aktif, invoice, profil prospek);
 * token yang datanya belum ada dibiarkan tampil apa adanya sehingga script ditandai belum siap kirim.
 */
export const SCRIPT_VARIABLES = [
  // Brand & CS
  'travel', 'cs_name', 'ppiu', 'bank', 'rekening', 'nama_rekening',
  // Paket aktif prospek
  'paket', 'tanggal_keberangkatan', 'durasi', 'maskapai', 'hotel', 'harga_mulai', 'harga_kamar', 'dp_per_orang',
  'fasilitas_termasuk', 'fasilitas_tidak_termasuk', 'kuota_paket', 'promo', 'batas_promo',
  // Penawaran & invoice pembayaran
  'nilai_penawaran', 'nominal_pembayaran_awal', 'nomor_invoice', 'batas_pembayaran',
  // Profil prospek
  'jumlah_jamaah', 'bulan_target', 'budget', 'tanggal_followup', 'kota',
] as const;

export type ScriptVariables = Partial<Record<(typeof SCRIPT_VARIABLES)[number], string | number>>;

const narrativeReplacements: Array<[RegExp, string]> = [
  [/\{\{agent_name\}\}/gi, '{{cs_name}}'],
  [/mitra agen konsultan/gi, 'Customer Service resmi {{travel}}'],
  [/agen resmi(?:\s+\{\{travel\}\})?/gi, 'tim layanan jamaah {{travel}}'],
  [/referral link agen/gi, 'kanal resmi {{travel}}'],
  [/sebagai agen\b/gi, 'sebagai konsultan umroh resmi {{travel}}'],
];

export function normalizeScriptNarrative(input: string) {
  return narrativeReplacements.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), input);
}

export function interpolateScript(input: string, variables: ScriptVariables) {
  const normalized = normalizeScriptNarrative(input);
  return normalized.replace(/\{\{([a-z0-9_]+)\}\}/gi, (match, key: string) => {
    const lookupKey = key.toLowerCase() as keyof ScriptVariables;
    const value = variables[lookupKey];
    return value === undefined || value === null || value === '' ? match : String(value);
  });
}

export function transformScriptTree<T>(value: T, variables: ScriptVariables): T {
  if (typeof value === 'string') return interpolateScript(value, variables) as T;
  if (Array.isArray(value)) return value.map((item) => transformScriptTree(item, variables)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, transformScriptTree(child, variables)]),
    ) as T;
  }
  return value;
}

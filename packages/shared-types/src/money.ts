/**
 * Nominal rupiah dari teks katalog (harga, DP) dengan aturan yang jelas. Nilai yang ambigu tidak diterka.
 *
 * Diterima:
 * - "Rp 5.000.000", "5.000.000", "5000000"            → 5_000_000 (titik = pemisah ribuan)
 * - "5.000.000,00", "5.000.000,-"                      → 5_000_000 (sen diabaikan)
 * - "5 juta", "5,5 jt", "5.5 juta", "750 ribu", "750rb" → dikalikan satuannya
 * Ditolak (null): teks tanpa angka, gabungan beberapa angka ("5-6 juta"), pemisah campur yang tidak baku.
 */
export function parseRupiahStrict(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  if (value === null || value === undefined) return null;
  let text = String(value).trim().toLowerCase();
  if (!text) return null;
  text = text.replace(/^(rp\.?|idr)\s*/, '').replace(/,-$/, '').replace(/\s+/g, ' ').trim();

  const unit = /^(\d+(?:[.,]\d+)?)\s*(juta|jt|ribu|rb)$/.exec(text);
  if (unit) {
    const amount = Number(unit[1]!.replace(',', '.'));
    const factor = unit[2] === 'juta' || unit[2] === 'jt' ? 1_000_000 : 1_000;
    return Number.isFinite(amount) ? Math.round(amount * factor) : null;
  }
  // Format Indonesia: titik ribuan, koma sen.
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(text)) return Number(text.split(',')[0]!.replace(/\./g, ''));
  // Angka polos, boleh dengan sen berkoma.
  if (/^\d+(,\d{1,2})?$/.test(text)) return Number(text.split(',')[0]);
  // Format internasional: koma ribuan, titik sen.
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(text)) return Number(text.split('.')[0]!.replace(/,/g, ''));
  return null;
}

/** "Rp36.500.000" — hanya tampilan; tidak menafsirkan teks. */
export function formatRupiah(amount: number) {
  return `Rp${Math.round(amount).toLocaleString('id-ID')}`;
}

/** Nominal katalog siap tampil, atau null bila teksnya ambigu/kosong (jangan tampilkan hasil tebakan). */
export function formatCatalogRupiah(value: unknown) {
  const amount = parseRupiahStrict(value);
  return amount && amount > 0 ? formatRupiah(amount) : null;
}

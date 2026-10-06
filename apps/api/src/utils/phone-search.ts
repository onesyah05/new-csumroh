/**
 * Potongan nomor untuk pencarian `contains` di kolom phone (tersimpan 62…). Nomor yang diketik format lokal "0812…"
 * tidak pernah cocok dengan "62812…", jadi nol di depan dibuang. Kurang dari 4 digit dianggap bukan pencarian nomor.
 */
export function phoneSearchDigits(search: string) {
  const digits = search.replace(/\D/g, '').replace(/^0+/, '');
  return digits.length >= 4 ? digits : null;
}

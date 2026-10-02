/**
 * Penyusun pesan WhatsApp bersama (audit S14, C02, C03, C10). Semua pesan penawaran, invoice, dan ringkasan paket
 * memakai aturan yang sama: blok dipisah satu baris kosong, *tebal* satu bintang, daftar dengan "•", tanpa huruf
 * kapital penuh, dan baris yang datanya kosong tidak ditulis (tidak ada "-" atau "belum dikonfirmasi").
 */
export type WaBlock = string | null | undefined | false | Array<string | null | undefined | false>;

/** Blok = paragraf; array = baris-baris dalam satu paragraf. Blok/baris kosong dibuang, jarak antarparagraf dijaga. */
export function waMessage(...blocks: WaBlock[]) {
  return blocks
    .map((block) => (Array.isArray(block) ? block.filter(Boolean).join('\n') : block || ''))
    .map((block) => block.trim())
    .filter(Boolean)
    .join('\n\n');
}

/** "Label: nilai" hanya bila nilainya ada. */
export function waLine(label: string, value: unknown) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text && text !== '-' ? `${label}: ${text}` : null;
}

/**
 * Daftar berbutir dari teks multibaris, selalu lengkap. Fasilitas dan terutama biaya yang belum termasuk tidak boleh
 * diringkas menjadi "dan N lainnya": jamaah tidak bisa melihat sisanya, dan brosur belum tentu memuatnya.
 */
export function waBullets(text: string | null | undefined) {
  return String(text ?? '').split('\n').map((line) => line.replace(/^[-•*\s]+/, '').trim()).filter(Boolean).map((item) => `• ${item}`);
}

/** Tanggal kolom DATE (UTC midnight) → "10 April 2026". */
export function waDate(value: unknown) {
  if (!value) return null;
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

/** Tanggal-jam (mis. batas pembayaran) → "10 April 2026 pukul 17.00 WIB". */
export function waDateTime(value: unknown) {
  if (!value) return null;
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return null;
  const day = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(date);
  const time = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(date);
  return `${day} pukul ${time} WIB`;
}

/** Nama paket tanpa huruf kapital penuh: "PAKET UMROH SYAWAL" → "Paket Umroh Syawal"; nama campuran dibiarkan. */
export function waTitle(name: string | null | undefined) {
  const text = String(name ?? '').trim();
  if (!text) return 'Paket umroh';
  if (text !== text.toUpperCase()) return text;
  return text.toLowerCase().replace(/(^|\s)(\S)/g, (_, space: string, char: string) => space + char.toUpperCase());
}

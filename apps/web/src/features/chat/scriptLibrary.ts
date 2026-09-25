import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export function unresolvedScript(text: string) { return /\{\{[^}]+\}\}|\[konfirmasi[^\]]*\]/i.test(text); }

export type ScriptStatus = 'ready' | 'needs_context' | 'blocked';
export type ScriptGap = { token: string; label: string; kind: 'fact' | 'context' };

/**
 * Pustaka script untuk satu prospek (audit S01, S13). Server membaca prospek + paketnya sendiri; client hanya
 * mengirim id. `revision` (updatedAt prospek) ikut di cache key sehingga script ikut berubah setiap data prospek
 * berubah; perubahan paket/kuota menyegarkan lewat event socket.
 */
export function useScriptLibrary({ brandId, prospectId, revision, packageId, query = '', enabled = true }: {
  brandId?: number; prospectId?: number | null; revision?: string | null; packageId?: number | null; query?: string; enabled?: boolean;
}) {
  return useQuery({
    queryKey: ['scripts', brandId, prospectId ?? null, prospectId ? revision ?? null : packageId ?? null],
    queryFn: () => {
      const params = new URLSearchParams(query);
      params.set('brandId', String(brandId));
      params.delete('nama');
      params.delete('packageId');
      if (prospectId) params.set('prospectId', String(prospectId));
      else if (packageId) params.set('packageId', String(packageId));
      return api.get<any>(`/scripts?${params}`);
    },
    enabled: !!brandId && enabled,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
}

/** Keberatan tercatat di prospek → kategori script TGJP yang relevan (audit S09). */
export const OBJECTION_SCRIPT_CATEGORIES: Record<string, string[]> = {
  price: ['harga_mahal', 'dp_berat', 'belum_ada_dana', 'menunggu_promo'],
  competitor: ['bandingkan_travel', 'sudah_punya_travel', 'takut_ditipu', 'minta_bukti_legalitas', 'minta_testimoni'],
  schedule_leave: ['jadwal_tidak_cocok', 'belum_siap_berangkat'],
  passport: ['belum_punya_paspor'],
  family_decision: ['diskusi_keluarga', 'diskusi_pasangan', 'mau_pikir_pikir'],
  facility_distance: ['hotel_jauh', 'maskapai', 'khawatir_kesehatan'],
};

/** Tebal WhatsApp: *teks* → segmen tebal; dipakai untuk pratinjau gelembung chat. */
export function whatsappSegments(text: string) {
  const parts: Array<{ text: string; bold: boolean }> = [];
  const pattern = /\*([^*\n]+)\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > last) parts.push({ text: text.slice(last, match.index), bold: false });
    parts.push({ text: match[1]!, bold: true });
    last = match.index! + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), bold: false });
  return parts;
}

/** Catatan editorial ringan untuk draft WhatsApp di layar ponsel (audit C12). */
export function draftWarnings(text: string) {
  const warnings: string[] = [];
  if (unresolvedScript(text)) warnings.push('Masih ada data yang belum terisi.');
  if (text.length > 450) warnings.push('Pesan panjang untuk layar ponsel. Pertimbangkan dipecah.');
  if ((text.match(/\?/g) ?? []).length > 1) warnings.push('Ada lebih dari satu pertanyaan. Satu pertanyaan lebih mudah dijawab.');
  if (text.includes('**')) warnings.push('Gunakan *satu bintang* untuk huruf tebal di WhatsApp.');
  return warnings;
}

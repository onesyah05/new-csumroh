/** Kategori pustaka script yang paling relevan untuk tahap pipeline prospek (dipakai Copilot dan Saran Balasan AI). */
export const SCRIPT_CATEGORIES = ['greeting', 'identification', 'offer', 'objection', 'closing', 'followups'] as const;
export type ScriptCategory = (typeof SCRIPT_CATEGORIES)[number];

export function recommendedCategory(stage?: string | null): ScriptCategory {
  if (stage === 'objection') return 'objection';
  if (['qualified'].includes(stage || '')) return 'offer';
  if (['offer', 'offered', 'followup', 'nurture', 'lose', 'closed_lost'].includes(stage || '')) return 'followups';
  if (['closing', 'deal', 'closed_won'].includes(stage || '')) return 'closing';
  if (['contact', 'identifying'].includes(stage || '')) return 'identification';
  return 'greeting';
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

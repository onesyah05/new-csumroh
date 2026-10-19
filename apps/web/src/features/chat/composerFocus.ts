export const COMPOSER_FOCUS_TTL_MS = 3000;

export interface ComposerFocusRequest { id: number; at: number }

/**
 * Keputusan fokus kolom pesan setelah CS membuka percakapan: 'focus' sekarang, 'wait' (belum bisa, coba lagi saat
 * keadaan berubah), atau 'drop' (permintaan basi atau tidak berlaku). Tidak di HP, sama seperti WhatsApp: keyboard
 * akan menutupi pesan. Permintaan kedaluwarsa dibuang agar fokus tidak direbut belakangan (mis. saat WA tersambung lagi).
 */
export function composerFocusDecision(input: {
  request: ComposerFocusRequest | null;
  selectedId: number | null;
  now: number;
  mobile: boolean;
  canSend: boolean;
  panelOpen: boolean;
}): 'focus' | 'wait' | 'drop' {
  const { request } = input;
  if (!request || request.id !== input.selectedId) return 'wait';
  if (input.mobile || input.now - request.at > COMPOSER_FOCUS_TTL_MS) return 'drop';
  if (!input.canSend || input.panelOpen) return 'wait';
  return 'focus';
}

import { createHash } from 'node:crypto';

/**
 * Nama event untuk action_source business_messaging. Meta hanya menerima daftar tertentu (Contact dan Lead ditolak
 * dengan subcode 2804066), jadi prospek baru = LeadSubmitted dan prospek terkualifikasi = QualifiedLead.
 */
export const CAPI_EVENT_NAMES = ['LeadSubmitted', 'QualifiedLead', 'AddToCart', 'InitiateCheckout', 'Purchase'] as const;
export type CapiEventName = (typeof CAPI_EVENT_NAMES)[number];

export const normalizePhone = (phone: string) => {
  const digits = phone.replace(/\D/g, '').replace(/^0/, '62');
  return digits.startsWith('62') ? digits : `62${digits}`;
};

export const sha256 = (value: string) => createHash('sha256').update(value.trim().toLowerCase()).digest('hex');

export function buildCapiEventId(prospectId: number, eventName: CapiEventName, closedWonCount = 0) {
  const suffix: Record<CapiEventName, string> = {
    // Sufiks lama (contact/lead) dipertahankan agar event yang pernah tercatat tidak dikirim ganda.
    LeadSubmitted: 'contact',
    QualifiedLead: 'lead',
    AddToCart: 'offered',
    InitiateCheckout: 'closing',
    Purchase: `won_${Math.max(1, closedWonCount)}`,
  };
  return `csumroh_prospect_${prospectId}_${suffix[eventName]}`;
}

export type CapiPayloadInput = {
  eventName: CapiEventName;
  eventId: string;
  eventTime?: number;
  phone: string;
  ctwaClid: string;
  pageId: string;
  whatsappBusinessAccountId?: string | null;
  /** Nama & kota prospek; dikirim ter-hash untuk menaikkan kualitas pencocokan di Meta. */
  name?: string | null;
  city?: string | null;
  value?: number;
  testEventCode?: string | null;
};

// Sapaan bukan bagian nama (Bpk. Abdullah, Ibu Salma, H. Miftah).
const HONORIFICS = new Set(['bpk', 'bapak', 'pak', 'ibu', 'bu', 'h', 'hj', 'haji', 'hajah', 'ust', 'ustadz', 'ustadzah', 'kak', 'mas', 'mbak', 'keluarga', 'dr', 'drs', 'ir']);

/** Nama dinormalisasi sesuai aturan Meta (huruf kecil, tanpa tanda baca). Nama kontak generik (+62…, angka) diabaikan. */
export function splitPersonName(name?: string | null) {
  const raw = (name ?? '').trim();
  if (!raw || /^\+?\d/.test(raw)) return { firstName: '', lastName: '' };
  const words = raw
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word && !HONORIFICS.has(word));
  return { firstName: words[0] ?? '', lastName: words.length > 1 ? words[words.length - 1]! : '' };
}

/** Kota tanpa awalan wilayah, huruf kecil, tanpa spasi/tanda baca (format ct Meta): "Kota Depok" → depok. */
export function normalizeCity(city?: string | null) {
  return (city ?? '')
    .trim()
    .toLowerCase()
    .replace(/^(kota|kabupaten|kab\.?)\s+/, '')
    .replace(/[^\p{L}]/gu, '');
}

export function buildCapiPayload(input: CapiPayloadInput) {
  const phone = normalizePhone(input.phone);
  const userData: Record<string, string | string[]> = {
    ph: [sha256(phone)],
    // Penanda klik iklan dikirim apa adanya: di-hash membuat Meta tidak bisa mencocokkan ke iklan.
    ctwa_clid: input.ctwaClid,
    page_id: input.pageId,
  };
  if (input.whatsappBusinessAccountId) userData.whatsapp_business_account_id = input.whatsappBusinessAccountId;
  const { firstName, lastName } = splitPersonName(input.name);
  if (firstName) userData.fn = [sha256(firstName)];
  if (lastName) userData.ln = [sha256(lastName)];
  const city = normalizeCity(input.city);
  if (city) userData.ct = [sha256(city)];
  if (phone.startsWith('62')) userData.country = [sha256('id')];

  return {
    data: [{
      event_name: input.eventName,
      event_time: input.eventTime ?? Math.floor(Date.now() / 1000),
      event_id: input.eventId,
      action_source: 'business_messaging' as const,
      messaging_channel: 'whatsapp' as const,
      user_data: userData,
      ...(input.value !== undefined ? { custom_data: { currency: 'IDR', value: input.value } } : {}),
    }],
    ...(input.testEventCode ? { test_event_code: input.testEventCode } : {}),
  };
}

export function validateEventValue(eventName: CapiEventName, dealValue: number, dpAmount: number) {
  if (eventName === 'Purchase' && dealValue <= 0) return { valid: false as const, reason: 'Nilai transaksi final belum diisi.' };
  if (eventName === 'InitiateCheckout' && dpAmount <= 0) return { valid: false as const, reason: 'Nominal tagihan invoice belum diterbitkan.' };
  return { valid: true as const, value: eventName === 'Purchase' ? dealValue : eventName === 'InitiateCheckout' ? dpAmount : dealValue > 0 ? dealValue : undefined };
}

/** WABA ID opsional: nomor WhatsApp Business biasa (tanpa WhatsApp Business API) umumnya tidak punya WABA. */
export function validateMetaConfig(config: { pixelId?: string | null; accessToken?: string | null; pageId?: string | null }) {
  if (!config.pixelId || !config.accessToken || !config.pageId) return { valid: false as const, reason: 'Konfigurasi Pixel ID, Page ID, atau access token brand belum lengkap.' };
  return { valid: true as const };
}

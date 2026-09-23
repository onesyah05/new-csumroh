import { createHash } from 'node:crypto';

export type CapiEventName = 'Contact' | 'AddToCart' | 'InitiateCheckout' | 'Purchase';

export const normalizePhone = (phone: string) => {
  const digits = phone.replace(/\D/g, '').replace(/^0/, '62');
  return digits.startsWith('62') ? digits : `62${digits}`;
};

export const sha256 = (value: string) => createHash('sha256').update(value.trim().toLowerCase()).digest('hex');

export function buildCapiEventId(prospectId: number, eventName: CapiEventName, closedWonCount = 0) {
  const suffix: Record<CapiEventName, string> = {
    Contact: 'contact',
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
  value?: number;
  testEventCode?: string | null;
};

export function buildCapiPayload(input: CapiPayloadInput) {
  const userData: Record<string, string | string[]> = {
    ph: [sha256(normalizePhone(input.phone))],
    ctwa_clid: input.ctwaClid,
    page_id: input.pageId,
  };
  if (input.whatsappBusinessAccountId) userData.whatsapp_business_account_id = input.whatsappBusinessAccountId;

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

export function validateMetaConfig(config: { pixelId?: string | null; accessToken?: string | null; pageId?: string | null; wabaId?: string | null }) {
  if (!config.pixelId || !config.accessToken || !config.pageId || !config.wabaId) return { valid: false as const, reason: 'Konfigurasi Pixel ID, Page ID, WABA ID, atau access token brand belum lengkap.' };
  return { valid: true as const };
}

import { createHash } from 'node:crypto';

export const normalizePhone = (phone: string) => {
  const digits = phone.replace(/\D/g, '').replace(/^0/, '62');
  return digits.startsWith('62') ? digits : `62${digits}`;
};
export const sha256 = (value: string) => createHash('sha256').update(value.trim().toLowerCase()).digest('hex');

export function buildCapiPayload(input: { eventName: string; eventId: string; phone: string; value?: number }) {
  return { data: [{ event_name: input.eventName, event_time: Math.floor(Date.now()/1000), event_id: input.eventId, action_source: 'business_messaging', user_data: { ph: [sha256(normalizePhone(input.phone))] }, ...(input.value ? { custom_data: { currency: 'IDR', value: input.value } } : {}) }] };
}

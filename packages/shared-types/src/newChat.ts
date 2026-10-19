import { z } from 'zod';

/** Sumber prospek yang dimasukkan CS dari DM sosmed. Disimpan di Prospect.leadSource sebagai `sosmed_<kunci>`. */
export const SOSMED_SOURCES = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'lainnya', label: 'Sosmed lainnya' },
] as const;
export type SosmedSource = (typeof SOSMED_SOURCES)[number]['value'];

export const sosmedLeadSource = (source: SosmedSource) => `sosmed_${source}`;
export const isSosmedLeadSource = (leadSource?: string | null) => Boolean(leadSource?.startsWith('sosmed_'));
export const leadSourceLabel = (leadSource?: string | null) => {
  const sosmed = SOSMED_SOURCES.find((item) => sosmedLeadSource(item.value) === leadSource);
  return sosmed ? `DM ${sosmed.label}` : null;
};

const pax = z.coerce.number().int().min(0).max(50).optional();

export const newChatInputSchema = z.object({
  brandId: z.coerce.number().int().positive().optional(),
  phone: z.string().trim().min(6).max(30),
  name: z.string().trim().max(100).optional(),
  source: z.enum(['instagram', 'facebook', 'tiktok', 'lainnya']),
  notes: z.string().trim().max(1000).optional(),
  text: z.string().trim().min(1).max(4000),
  targetMonth: z.string().trim().max(50).optional(),
  budgetRange: z.string().trim().max(50).optional(),
  paxQuad: pax,
  paxTriple: pax,
  paxDouble: pax,
  paxInfant: pax,
});
export type NewChatInput = z.infer<typeof newChatInputSchema>;

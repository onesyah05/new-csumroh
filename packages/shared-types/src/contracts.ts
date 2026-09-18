import { z } from 'zod';

export const roleSchema = z.enum(['superadmin', 'admin', 'cs']);
export type Role = z.infer<typeof roleSchema>;

export const pipelineStatuses = [
  'new',
  'identifying',
  'offered',
  'objection',
  'followup',
  'closing',
  'closed_won',
  'closed_lost',
] as const;

export const prospectStatusSchema = z.enum([...pipelineStatuses, 'nurture']);
export type ProspectStatus = z.infer<typeof prospectStatusSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const prospectInputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(8).max(30).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  leadSource: z.string().trim().max(50).default('whatsapp'),
  packageId: z.number().int().positive().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  nextFollowupDate: z.string().date().nullable().optional(),
});

export const statusUpdateSchema = z.object({ status: prospectStatusSchema });

export const messageInputSchema = z.object({
  prospectId: z.number().int().positive(),
  text: z.string().trim().min(1).max(4000),
  quotedMessageId: z.string().max(100).optional(),
});

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
  brandId: number | null;
  brand?: { id: number; name: string; code: string } | null;
};

export type ApiResponse<T> = { success: true; data: T };
export type ApiError = { success: false; error: string; details?: unknown };

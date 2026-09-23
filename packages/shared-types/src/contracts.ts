import { z } from 'zod';

export const roleSchema = z.enum(['superadmin', 'admin', 'cs', 'finance']);
export type Role = z.infer<typeof roleSchema>;

export const pipelineStatuses = [
  'new',
  'contact',
  'qualified',
  'offer',
  'objection',
  'followup',
  'closing',
  'deal',
  'lose',
] as const;

export const legacyStatuses = ['identifying', 'offered', 'closed_won', 'closed_lost'] as const;

export const prospectStatusSchema = z.enum([
  ...pipelineStatuses,
  ...legacyStatuses,
  'nurture',
]);
export type ProspectStatus = z.infer<typeof prospectStatusSchema>;

// Pengiriman dokumen resmi: `sendViaWhatsApp` hanya niat. Status "terkirim" baru dicatat
// setelah gateway WhatsApp mengembalikan messageId. Tanpa flag = draft.
export const offerInputSchema = z.object({
  packageId: z.number().int().positive(),
  paxSummary: z.string().max(255).optional(),
  // Nilai penawaran dihitung backend dari harga paket × pax. Override hanya dihormati untuk admin/finance.
  dealValue: z.number().nonnegative().optional(),
  customNotes: z.string().max(2000).optional(),
  messageText: z.string().trim().max(4000).optional(),
  sendViaWhatsApp: z.boolean().default(false),
});

export const invoiceInputSchema = z.object({
  packageId: z.number().int().positive().optional().nullable(),
  // Nominal TAGIHAN; tidak pernah dianggap sebagai uang yang diterima.
  invoiceAmount: z.number().positive(),
  dueDate: z.string().optional().nullable(),
  bankAccountName: z.string().max(100).optional(),
  messageText: z.string().trim().max(4000).optional(),
  sendViaWhatsApp: z.boolean().default(false),
});

export const prospectProfileSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  targetMonth: z.string().trim().max(50).nullable().optional(),
  budgetRange: z.string().trim().max(50).nullable().optional(),
  roomPreference: z.string().trim().max(50).nullable().optional(),
  paxQuad: z.coerce.number().int().min(0).max(200).optional(),
  paxTriple: z.coerce.number().int().min(0).max(200).optional(),
  paxDouble: z.coerce.number().int().min(0).max(200).optional(),
  paxInfant: z.coerce.number().int().min(0).max(200).optional(),
  specialNeeds: z.string().max(5000).nullable().optional(),
  decisionMaker: z.string().trim().max(50).nullable().optional(),
  passportStatus: z.string().trim().max(50).nullable().optional(),
  vaccineStatus: z.string().trim().max(50).nullable().optional(),
  lostReason: z.string().trim().max(100).nullable().optional(),
  lostReasonDetail: z.string().max(5000).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  // YYYY-MM-DD (tanggal bisnis WIB) atau ISO datetime; disimpan sebagai DATE
  nextFollowupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/).nullable().optional().or(z.literal('')),
  packageId: z.number().int().positive().nullable().optional(),
  objectionCategory: z.string().trim().max(50).nullable().optional(),
  objectionNotes: z.string().max(5000).nullable().optional(),
});
export type ProspectProfileInput = z.infer<typeof prospectProfileSchema>;

/** Field settlement yang tidak boleh diubah lewat profil; hanya lewat verifikasi Finance. */
export const settlementFields = ['dealValue', 'dpAmount', 'paymentStatus', 'dpPaidAt'] as const;

export const objectionInputSchema = z.object({
  category: z.enum([
    'price',
    'competitor',
    'schedule_leave',
    'passport',
    'family_decision',
    'facility_distance',
    'other',
  ]),
  notes: z.string().trim().max(2000),
});

export const paymentVerifySchema = z.object({
  // Nominal mutasi INI (bukan saldo kumulatif). Total kas = jumlah seluruh mutasi terverifikasi.
  approvedAmount: z.number().positive(),
  bankName: z.string().trim().min(1).max(50),
  referenceNo: z.string().trim().max(100).optional().or(z.literal('')),
  mutationDate: z.string().date().optional().or(z.literal('')),
  notes: z.string().max(500).optional(),
  // Dibuat client sekali per form; request ulang dengan key sama tidak mencatat pembayaran ganda.
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
});

export const PAYMENT_PROOF_PATH_PREFIX = '/api/v1/prospects/payment-proof-file/';
export const paymentProofSchema = z.object({
  // Hanya referensi berkas privat hasil endpoint upload; data URL / URL bebas ditolak.
  paymentProofUrl: z.string().max(300).regex(/^\/api\/v1\/prospects\/payment-proof-file\/[A-Za-z0-9._-]+$/, 'Bukti bayar harus diunggah melalui endpoint upload resmi.'),
  notes: z.string().max(500).optional(),
});

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

export const statusUpdateSchema = z.object({
  status: prospectStatusSchema,
  lostReason: z.string().max(500).optional().nullable(),
});

export const messageInputSchema = z.object({
  prospectId: z.number().int().positive(),
  text: z.string().trim().min(1).max(4000),
  quotedMessageId: z.string().max(100).optional(),
  quotedText: z.string().max(1000).optional(),
  quotedSender: z.string().max(100).optional(),
});

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
  brandId: number | null;
  brand?: { id: number; name: string; code: string } | null;
  userBrands?: { brand: { id: number; name: string; code: string } }[];
};

export type ApiResponse<T> = { success: true; data: T };
export type ApiError = { success: false; error: string; details?: unknown };

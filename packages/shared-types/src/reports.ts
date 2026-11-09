/** Laporan: Superadmin & Admin melihat semua tab; CS hanya tab Lead Harian (dibatasi di API dan halaman). */
export const REPORT_ROLES = ['superadmin', 'admin', 'cs'] as const;
export const canSeeReports = (role?: string | null) => (REPORT_ROLES as readonly string[]).includes(role ?? '');

/** Kunci baris "Dari HP": pesan yang diketik langsung di HP WhatsApp brand, tanpa akun CRM. */
export const LEAD_PHONE_KEY = 'hp';

/** Satu baris Lead Harian: nomor yang ditangani satu CS (atau "Dari HP"), dihitung per nomor per hari. */
export type LeadHandlingRow = {
  key: string;
  userId: number | null;
  name: string;
  isActive: boolean;
  newLeads: number;
  oldLeads: number;
  medianReplyMinutes: number | null;
};

/**
 * Total = nomor berbeda per hari. Satu nomor yang dichat dua CS pada hari yang sama masuk di baris kedua CS, tetapi
 * di total dihitung sekali, jadi total bisa lebih kecil dari jumlah baris.
 */
export type LeadHandlingReport = { brandId: number | null; rows: LeadHandlingRow[]; totals: { newLeads: number; oldLeads: number } };

/** Urutan CS di Lead Harian: total nomor ditangani terbanyak, lalu nama. */
export const compareLeadRows = (a: LeadHandlingRow, b: LeadHandlingRow) =>
  b.newLeads + b.oldLeads - (a.newLeads + a.oldLeads) || a.name.localeCompare(b.name);

import type { PaymentHistoryStatus } from '@csumroh/shared-types';

export type HistoryRow = {
  key: string;
  type: 'payment' | 'rejection';
  id: number;
  status: 'verified' | 'reversed' | 'rejected';
  at: string;
  brand: { id: number; name: string; code: string };
  prospect: { id: number; name: string; phone: string | null; invoiceNumber: string | null; paymentStatus: string; status: string };
  amount: number | null;
  paymentType: 'dp' | 'full' | null;
  bankName: string | null;
  referenceNo: string | null;
  mutationDate: string | null;
  notes: string | null;
  proofUrl: string | null;
  actor: string | null;
  reason: string | null;
  correctedAt: string | null;
  reversedAt: string | null;
  reversedBy: string | null;
};

export type HistoryPage = {
  items: HistoryRow[];
  page: number;
  pageSize: number;
  total: number;
  totals: {
    verifiedCount: number;
    verifiedAmount: number;
    rejectedCount: number;
    reversedCount: number;
    byBank: { bankName: string; count: number; amount: number }[];
  };
};

export type VerificationSummary = {
  verifiedToday: number;
  verifiedAmountToday: number;
  rejectedToday: number;
  avgVerifyMinutes: number | null;
};

export type HistoryFilter = { status: PaymentHistoryStatus; from: string; to: string; q: string };

export const historyQuery = (brandScope: string, filter: HistoryFilter, page?: number) => {
  const params = new URLSearchParams({ brandId: brandScope, status: filter.status });
  if (filter.from) params.set('from', filter.from);
  if (filter.to) params.set('to', filter.to);
  if (filter.q.trim()) params.set('q', filter.q.trim());
  if (page) params.set('page', String(page));
  return params.toString();
};

export const rupiah = (value: unknown) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value ?? 0));

/** "35 menit", "4 jam", "2 hari". */
export const durationLabel = (minutes: number) =>
  minutes < 60 ? `${minutes} menit` : minutes < 1440 ? `${Math.round(minutes / 60)} jam` : `${Math.round(minutes / 1440)} hari`;

export const wibDateTime = (value: string) =>
  new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(value));

export const dateLabel = (value: string) =>
  new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));

import {
  BUDGET_OPTIONS, dateOnlyKey, DECISION_MAKER_OPTIONS, objectionLabel, optionLabel, PASSPORT_OPTIONS, targetMonthLabel,
} from '@csumroh/shared-types';

/**
 * Riwayat prospek yang bisa dibaca manusia. Setiap simpan profil mencatat APA yang berubah (nilai lama → baru),
 * bukan sekadar "profil diperbarui", sehingga supervisor bisa menelusuri perubahan data oleh CS.
 */
const empty = '–';
const text = (value: unknown) => {
  const v = value === null || value === undefined ? '' : String(value).trim();
  return v || empty;
};
const clip = (value: unknown, max = 120) => {
  const v = text(value);
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
};
const date = (value: unknown) => {
  const key = dateOnlyKey(value);
  if (!key) return empty;
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${key}T00:00:00.000Z`));
};
const option = (options: Parameters<typeof optionLabel>[0]) => (value: unknown) => (value ? optionLabel(options, String(value)) ?? String(value) : empty);
const people = (value: unknown) => `${Number(value) || 0} orang`;

const FIELDS: Array<{ key: string; label: string; format: (value: unknown) => string }> = [
  { key: 'name', label: 'Nama', format: text },
  { key: 'phone', label: 'Nomor WhatsApp', format: text },
  { key: 'city', label: 'Kota', format: text },
  { key: 'targetMonth', label: 'Bulan keberangkatan', format: (v) => (v ? targetMonthLabel(String(v)) ?? String(v) : empty) },
  { key: 'paxQuad', label: 'Quad', format: people },
  { key: 'paxTriple', label: 'Triple', format: people },
  { key: 'paxDouble', label: 'Double', format: people },
  { key: 'paxInfant', label: 'Bayi', format: people },
  { key: 'budgetRange', label: 'Budget', format: option(BUDGET_OPTIONS) },
  { key: 'passportStatus', label: 'Paspor', format: option(PASSPORT_OPTIONS) },
  { key: 'decisionMaker', label: 'Pengambil keputusan', format: option(DECISION_MAKER_OPTIONS) },
  { key: 'vaccineStatus', label: 'Vaksin', format: text },
  { key: 'specialNeeds', label: 'Kebutuhan khusus', format: (v) => clip(v) },
  { key: 'nextFollowupDate', label: 'Follow-up berikutnya', format: date },
  { key: 'objectionCategory', label: 'Kategori keberatan', format: (v) => (v ? objectionLabel(String(v)) : empty) },
  { key: 'objectionNotes', label: 'Catatan keberatan', format: (v) => clip(v) },
];

/** Baris "Label: lama → baru" untuk isian yang benar-benar berubah. Paket diberi nama dari luar (butuh query). */
export function describeProfileChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  packages?: { before?: string | null; after?: string | null },
) {
  const lines: string[] = [];
  for (const field of FIELDS) {
    if (!(field.key in after)) continue;
    const from = field.format(before[field.key]);
    const to = field.format(after[field.key]);
    if (from !== to) lines.push(`${field.label}: ${from} → ${to}`);
  }
  if (packages && (packages.before ?? null) !== (packages.after ?? null)) {
    lines.push(`Paket: ${text(packages.before)} → ${text(packages.after)}`);
  }
  return lines;
}

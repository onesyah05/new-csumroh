import { AlertTriangle, Check, X } from 'lucide-react';
import {
  BUDGET_OPTIONS, MAX_EXTRA_MONTHS, PASSPORT_OPTIONS,
  adultPaxOf, joinExtraMonths, matchPackages, parseExtraMonths, parseTargetMonth, passportWarning,
  qualificationMissing, targetMonthLabel, upcomingTargetMonths, type MatchablePackage,
} from '@csumroh/shared-types';
import { Select } from '../../components/ui/select';
import { cn } from '../../lib/cn';

export type QualificationValue = {
  targetMonth: string; targetMonthsExtra: string; budgetRange: string; passportStatus: string; city: string;
  paxQuad: number; paxTriple: number; paxDouble: number; paxInfant: number;
};

const NONE = 'none';
const LEGACY = 'legacy';
const label = 'mb-1 block text-xs font-semibold text-zinc-600';
const moneyShort = (value: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', notation: 'compact', maximumFractionDigits: 1 }).format(value);

/** Pilihan baku; nilai lama (teks bebas) tetap tampil sebagai opsi "data lama" sampai CS memilih ulang. */
function withLegacy(options: readonly { value: string; label: string }[], current: string, placeholder: string) {
  const known = !current || options.some((o) => o.value === current);
  return [
    { value: NONE, label: placeholder },
    ...(known ? [] : [{ value: current, label: `${current} (data lama)` }]),
    ...options.map((o) => ({ value: o.value, label: o.label })),
  ];
}

/** Angka jamaah dari teks: hanya digit, tanpa nol di depan ("01" → 1), maksimal 200. */
const toCount = (text: string) => Math.min(200, Number(text.replace(/\D/g, '')) || 0);

/**
 * Isian kualifikasi yang sama di Inbox, modal Pipeline, dan halaman detail prospek. Boleh diisi bertahap;
 * status naik ke Terkualifikasi hanya bila semua isian bertanda * terisi (paspor dan domisili opsional). Kamar utama diturunkan dari pax.
 */
export function QualificationFields({
  value, onChange, disabled, bookingLocked, bookingLockedReason, packages, selectedPackageId, onSelectPackage, departure, layout = 'panel', showSummary = true,
}: {
  value: QualificationValue;
  onChange(patch: Partial<QualificationValue>): void;
  disabled?: boolean;
  /** Deal: jamaah terkunci karena seat sudah dipotong. */
  bookingLocked?: boolean;
  /** Alasan kunci selain Deal (mis. layanan custom). */
  bookingLockedReason?: string;
  packages?: MatchablePackage[];
  selectedPackageId?: string;
  onSelectPackage?(packageId: string): void;
  /** Tanggal berangkat paket terpilih, untuk peringatan paspor. */
  departure?: Date | null;
  layout?: 'panel' | 'page';
  /** Baris "Belum diisi" di atas isian; Inbox mematikannya karena sudah ada di "Langkah berikutnya". */
  showSummary?: boolean;
}) {
  const target = parseTargetMonth(value.targetMonth);
  const months = upcomingTargetMonths();
  const monthOptions = [
    { value: NONE, label: 'Pilih bulan...' },
    ...(target.legacy ? [{ value: LEGACY, label: `${target.legacy} (data lama, pilih ulang)` }] : []),
    ...(target.key && !months.some((m) => m.value === target.key) ? [{ value: target.key, label: targetMonthLabel(target.key)! }] : []),
    ...months,
  ];
  // Bulan rencana tambahan (maks MAX_EXTRA_MONTHS); bulan utama tetap yang menentukan kualifikasi.
  const extras = parseExtraMonths(value.targetMonthsExtra).filter((key) => key !== target.key);
  const extraOptions = [
    { value: NONE, label: '+ Tambah bulan' },
    ...months.filter((m) => m.value !== target.key && !extras.includes(m.value)),
  ];
  const adults = adultPaxOf(value);
  const missing = qualificationMissing(value);
  const warning = passportWarning({ passportStatus: value.passportStatus, targetMonth: value.targetMonth, departure });
  const matches = packages && target.key ? matchPackages(packages, { ...value, targetMonthsExtra: joinExtraMonths(extras) }) : null;
  const grid = layout === 'page' ? 'grid gap-3 sm:grid-cols-2' : 'grid gap-3 md:grid-cols-2 md:gap-2';

  return (
    <div className="space-y-3">
      {showSummary && (
        <p className={cn('flex items-center gap-1.5 text-xs', missing.length ? 'text-amber-800' : 'text-emerald-800')}>
          {missing.length ? <AlertTriangle size={13} className="shrink-0" aria-hidden="true" /> : <Check size={13} className="shrink-0" aria-hidden="true" />}
          <span>{missing.length ? <>Belum diisi: <b>{missing.join(', ')}</b></> : 'Kualifikasi lengkap'}</span>
        </p>
      )}

      <div>
        <span className={label}>Bulan keberangkatan *</span>
        <Select
          aria-label="Bulan keberangkatan"
          value={target.key ?? (target.legacy ? LEGACY : NONE)}
          disabled={disabled}
          onValueChange={(v) => { if (v !== LEGACY) onChange({ targetMonth: v === NONE ? '' : v }); }}
          options={monthOptions}
          className="w-full"
        />
        {target.key && (extras.length > 0 || !disabled) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {extras.map((key) => (
              <span key={key} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-1 pl-2.5 pr-1.5 text-xs font-medium text-zinc-800">
                {targetMonthLabel(key)}
                {!disabled && (
                  <button
                    type="button"
                    aria-label={`Hapus bulan ${targetMonthLabel(key)}`}
                    onClick={() => onChange({ targetMonthsExtra: joinExtraMonths(extras.filter((item) => item !== key)) })}
                    className="grid h-4 w-4 place-items-center rounded-full text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900"
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                )}
              </span>
            ))}
            {!disabled && extras.length < MAX_EXTRA_MONTHS && (
              <div className="w-40">
                <Select
                  aria-label="Tambah bulan rencana"
                  value={NONE}
                  onValueChange={(v) => { if (v !== NONE) onChange({ targetMonthsExtra: joinExtraMonths([...extras, v]) }); }}
                  options={extraOptions}
                  size="sm"
                  className="w-full"
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
          <span className="font-semibold text-zinc-600">Jumlah jamaah * <span className="font-normal text-zinc-500">(dewasa per kamar)</span></span>
          <span className="tabular-nums text-zinc-700">
            {adults} dewasa{value.paxInfant > 0 ? ` + ${value.paxInfant} bayi` : ''}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5 text-center">
          {([
            ['paxQuad', 'Quad'],
            ['paxTriple', 'Triple'],
            ['paxDouble', 'Double'],
            ['paxInfant', 'Bayi <2 th'],
          ] as const).map(([field, name]) => (
            <label key={field} className="flex flex-col items-center gap-1">
              <span className="text-xs text-zinc-600">{name}</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={3}
                aria-label={`Jamaah ${name}`}
                value={String(value[field] ?? 0)}
                disabled={disabled || bookingLocked}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => onChange({ [field]: toCount(e.target.value) })}
                className="h-8 w-full min-w-0 rounded-md border border-zinc-200 bg-white text-center text-sm font-semibold tabular-nums text-zinc-900 outline-none focus:border-zinc-900 disabled:bg-zinc-100"
              />
            </label>
          ))}
        </div>
        {bookingLocked && <p className="mt-1 text-xs text-zinc-500">{bookingLockedReason ?? 'Terkunci pada booking Deal.'}</p>}
      </div>

      <div className={grid}>
        <div>
          <span className={label}>Budget per orang *</span>
          <Select
            aria-label="Budget per orang"
            value={value.budgetRange || NONE}
            disabled={disabled}
            onValueChange={(v) => onChange({ budgetRange: v === NONE ? '' : v })}
            options={withLegacy(BUDGET_OPTIONS, value.budgetRange, 'Pilih budget...')}
            className="w-full"
          />
        </div>
        <div>
          <span className={label}>Paspor <span className="font-normal text-zinc-500">(opsional)</span></span>
          <Select
            aria-label="Status paspor"
            value={value.passportStatus || NONE}
            disabled={disabled}
            onValueChange={(v) => onChange({ passportStatus: v === NONE ? '' : v })}
            options={withLegacy(PASSPORT_OPTIONS, value.passportStatus, 'Pilih status...')}
            className="w-full"
          />
        </div>
      </div>
      <label className="block">
        <span className={label}>Domisili <span className="font-normal text-zinc-500">(opsional)</span></span>
        <input
          type="text"
          maxLength={100}
          aria-label="Domisili"
          placeholder="Kota atau kabupaten"
          value={value.city}
          disabled={disabled}
          onChange={(e) => onChange({ city: e.target.value })}
          className="field"
        />
      </label>
      {warning && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-amber-800">
          <AlertTriangle size={13} className="mt-px shrink-0" aria-hidden="true" />{warning}
        </p>
      )}

      {matches && (
        <section aria-label="Paket yang cocok" className="border-t border-zinc-100 pt-3">
          <h4 className="text-xs font-semibold text-zinc-900">
            Paket yang cocok · {[target.key, ...extras].map((key) => targetMonthLabel(key)).join(', ')}
          </h4>
          {matches.length === 0 ? (
            <p className="mt-1 text-xs text-zinc-600">Tidak ada paket yang cocok.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {matches.map(({ pkg, fromPrice }) => {
                const chosen = String(pkg.id) === selectedPackageId;
                const date = pkg.departureDate
                  ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(pkg.departureDate))
                  : '';
                return (
                  <li key={pkg.id} className="flex items-center gap-2 py-2 text-xs">
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 font-semibold text-zinc-900">{pkg.name}</span>
                      <span className="block text-zinc-600">
                        {date}{fromPrice ? ` · ${moneyShort(fromPrice)}` : ''}{pkg.quotaRemaining != null ? ` · sisa ${pkg.quotaRemaining}` : ''}
                      </span>
                    </span>
                    {onSelectPackage && (
                      <button
                        type="button"
                        disabled={disabled || bookingLocked || chosen}
                        onClick={() => onSelectPackage(String(pkg.id))}
                        className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 font-semibold text-zinc-800 hover:border-zinc-500 disabled:border-zinc-200 disabled:text-zinc-500"
                      >
                        {chosen ? 'Dipilih' : 'Pilih'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

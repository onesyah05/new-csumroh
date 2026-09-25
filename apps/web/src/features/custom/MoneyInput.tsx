import { cn } from '../../lib/cn';

/** Nominal rupiah: hanya angka, ditampilkan dengan titik ribuan ("72.000.000"). 0 tetap tampil sebagai "0". */
export function MoneyInput({ value, onChange, id, invalid, disabled, placeholder = '0', 'aria-label': ariaLabel, className }: {
  value: number | null; onChange(value: number | null): void; id?: string; invalid?: boolean; disabled?: boolean; placeholder?: string;
  'aria-label'?: string; className?: string;
}) {
  return <label className={cn('relative block', className)}>
    <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">Rp</span>
    <input id={id} inputMode="numeric" aria-label={ariaLabel} aria-invalid={invalid || undefined} disabled={disabled} placeholder={placeholder}
      value={value === null || value === undefined ? '' : value.toLocaleString('id-ID')}
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, '').slice(0, 13);
        onChange(digits ? Number(digits) : null);
      }}
      className={cn('field pl-9 tabular-nums', invalid && 'border-rose-400 focus:border-rose-600 focus:ring-rose-600')} />
  </label>;
}

import { cn } from '../../lib/cn';

/** Saklar aktif/mati (role="switch"). */
export function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange(next: boolean): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition',
        checked ? 'border-zinc-950 bg-zinc-950' : 'border-zinc-300 bg-zinc-200',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  );
}

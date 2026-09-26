import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../lib/cn';

export type RowAction = {
  label: string;
  icon?: LucideIcon;
  /** Tujuan navigasi; dipakai bila tidak ada `onSelect`. */
  to?: string;
  onSelect?: () => void;
  /** Tindakan merusak (hapus): dipisah garis dan berwarna merah. */
  danger?: boolean;
  /** Sembunyikan tanpa mengubah urutan deklarasi (mis. karena hak akses). */
  hidden?: boolean;
};

/**
 * Kolom "Aksi" tabel: satu tombol ellipsis berisi daftar tindakan baris. Menjaga kolom tetap sempit dan
 * seragam antar tabel; tindakan merusak diletakkan terakhir, dipisah garis.
 */
export function RowActions({ label, actions }: { label: string; actions: RowAction[] }) {
  const navigate = useNavigate();
  const visible = actions.filter((a) => !a.hidden);
  if (visible.length === 0) return null;
  const normal = visible.filter((a) => !a.danger);
  const danger = visible.filter((a) => a.danger);

  const item = (action: RowAction) => {
    const Icon = action.icon;
    return (
      <DropdownMenu.Item
        key={action.label}
        onSelect={() => (action.onSelect ? action.onSelect() : action.to && navigate(action.to))}
        className={cn(
          'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium outline-none',
          action.danger ? 'text-rose-700 data-[highlighted]:bg-rose-50' : 'text-zinc-700 data-[highlighted]:bg-zinc-100 data-[highlighted]:text-zinc-950',
        )}
      >
        {Icon && <Icon size={13} aria-hidden="true" className={action.danger ? 'text-rose-600' : 'text-zinc-500'} />}
        {action.label}
      </DropdownMenu.Item>
    );
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/15 data-[state=open]:bg-zinc-100 data-[state=open]:text-zinc-900"
        aria-label={label}
        title="Aksi"
      >
        <MoreHorizontal size={16} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-[190px] rounded-xl border border-zinc-200 bg-white p-1 shadow-lift">
          {normal.map(item)}
          {danger.length > 0 && normal.length > 0 && <DropdownMenu.Separator className="my-1 border-t border-zinc-100" />}
          {danger.map(item)}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

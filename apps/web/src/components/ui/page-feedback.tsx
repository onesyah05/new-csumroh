import type { ReactNode } from 'react';
import { AlertCircle, Inbox, RefreshCw, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Button } from './button';

export function PageLoading({ label = 'Memuat halaman' }: { label?: string }) {
  return (
    <div className="grid min-h-[52vh] place-items-center" role="status" aria-live="polite">
      <div className="text-center">
        <span className="mx-auto block h-9 w-9 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-950" />
        <p className="mt-4 text-xs font-bold text-zinc-500">{label}</p>
      </div>
    </div>
  );
}

export function PageError({ title = 'Data belum dapat dimuat', description, onRetry }: { title?: string; description?: string; onRetry?: () => void }) {
  return (
    <div className="grid min-h-[52vh] place-items-center p-2" role="alert">
      <section className="w-full max-w-md rounded-3xl border bg-white p-7 text-center shadow-soft">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-zinc-100 text-zinc-700"><AlertCircle size={20} /></span>
        <h2 className="mt-4 font-display text-lg font-extrabold">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-500">{description ?? 'Periksa koneksi server, lalu coba kembali.'}</p>
        {onRetry && <Button className="mt-5" onClick={onRetry}><RefreshCw size={15} />Coba lagi</Button>}
      </section>
    </div>
  );
}

/**
 * Tampilan kosong standar (satu komponen untuk seluruh aplikasi).
 * - `plain`: di dalam tabel/kartu/daftar yang sudah punya bingkai.
 * - `section`: berdiri sendiri, dengan bingkai garis putus-putus.
 * Deskripsi menjelaskan kenapa kosong; `action` memberi jalan keluar (reset filter, tambah data).
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  variant = 'plain',
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  variant?: 'plain' | 'section';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        variant === 'section' ? 'min-h-48 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/60 p-7' : 'px-4 py-12',
        className,
      )}
    >
      <span className="grid h-10 w-10 place-items-center rounded-xl border border-zinc-200 bg-white text-zinc-500">
        <Icon size={18} aria-hidden="true" />
      </span>
      <p className="mt-3 text-sm font-semibold text-zinc-900">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs leading-5 text-zinc-600">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Alias lama untuk `EmptyState variant="section"`. */
export function SectionEmpty({ title, description }: { title: string; description: string }) {
  return <EmptyState variant="section" title={title} description={description} />;
}

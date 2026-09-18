import { AlertCircle, Inbox, RefreshCw } from 'lucide-react';
import { Button } from './button';

export function PageLoading({ label = 'Memuat halaman' }: { label?: string }) {
  return (
    <div className="grid min-h-[52vh] place-items-center" role="status" aria-live="polite">
      <div className="text-center">
        <span className="mx-auto block h-9 w-9 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-950" />
        <p className="mt-4 text-xs font-bold uppercase tracking-[.14em] text-zinc-400">{label}</p>
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

export function SectionEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed bg-zinc-50/60 p-7 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-xl border bg-white text-zinc-500"><Inbox size={18} /></span>
      <h3 className="mt-3 font-display text-sm font-bold">{title}</h3>
      <p className="mt-1 max-w-sm text-xs leading-5 text-zinc-500">{description}</p>
    </div>
  );
}

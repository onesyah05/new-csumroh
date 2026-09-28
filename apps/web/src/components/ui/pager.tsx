import { Button } from './button';

/** Footer tabel berhalaman: "1–25 dari 312" + Sebelumnya/Berikutnya (gaya sama dengan Riwayat Finance). */
export function Pager({ page, pageSize, total, onPage, label }: { page: number; pageSize: number; total: number; onPage(page: number): void; label?: string }) {
  if (!total) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <footer className="flex items-center justify-between gap-2 border-t border-zinc-200 bg-zinc-50/75 px-4 py-2 text-xs text-zinc-600">
      <span className="tabular-nums">{first}–{last} dari {total}{label ? ` ${label}` : ''}</span>
      {total > pageSize && (
        <span className="flex gap-1.5">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Sebelumnya</Button>
          <Button size="sm" variant="secondary" disabled={last >= total} onClick={() => onPage(page + 1)}>Berikutnya</Button>
        </span>
      )}
    </footer>
  );
}

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { compareLeadRows, LEAD_PHONE_KEY, type LeadHandlingReport, type LeadHandlingRow } from '@csumroh/shared-types';
import { cn } from '../../lib/cn';
import { durationLabel } from '../finance/verificationApi';

const OTHERS_KEY = 'lainnya';
const TOP = 5;
// Warna kategori tetap per CS di kedua grafik; "Lainnya" dan "Dari HP" netral agar tidak terbaca sebagai CS.
const PALETTE = ['#0f766e', '#2563eb', '#d97706', '#7c3aed', '#db2777'];
const OTHERS_COLOR = '#71717a';
const PHONE_COLOR = '#d4d4d8';

const num = (value: number) => new Intl.NumberFormat('id-ID').format(value);
const replyText = (minutes: number | null) => (minutes === null ? '—' : minutes < 1 ? '< 1 menit' : durationLabel(minutes));

type Slice = { key: string; label: string; value: number; color: string };

/** 5 CS teratas (total nomor ditangani) mendapat warna sendiri; sisanya digabung "Lainnya"; "Dari HP" selalu terakhir. */
export function leadSlices(rows: LeadHandlingRow[], metric: 'newLeads' | 'oldLeads'): Slice[] {
  const people = rows.filter((r) => r.key !== LEAD_PHONE_KEY);
  const ranked = [...people].sort(compareLeadRows);
  const top = ranked.slice(0, TOP).filter((r) => r.newLeads + r.oldLeads > 0);
  const topKeys = new Set(top.map((r) => r.key));
  // Warna dari peringkat total (sama di kedua pie); urutan irisan dari nilai pie ini.
  const slices: Slice[] = top.map((r, i) => ({ key: r.key, label: r.name, value: r[metric], color: PALETTE[i]! }))
    .sort((a, b) => b.value - a.value);
  const others = people.filter((r) => !topKeys.has(r.key)).reduce((sum, r) => sum + r[metric], 0);
  if (others > 0) slices.push({ key: OTHERS_KEY, label: 'Lainnya', value: others, color: OTHERS_COLOR });
  const phone = rows.find((r) => r.key === LEAD_PHONE_KEY);
  if (phone && phone[metric] > 0) slices.push({ key: LEAD_PHONE_KEY, label: phone.name, value: phone[metric], color: PHONE_COLOR });
  return slices.filter((s) => s.value > 0);
}

const RADIUS = 15.9155; // keliling 100 → dasharray dalam persen
const sharePct = (value: number, total: number) => Math.round((value / total) * 100);

/** `count` = nomor berbeda (label tengah); persen irisan = bagian dari jumlah semua irisan. */
function Donut({ title, count, slices }: { title: string; count: number; slices: Slice[] }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  return (
    <section className="rounded-xl border border-zinc-200 bg-white">
      <header className="border-b border-zinc-200 bg-zinc-50/75 px-4 py-2.5">
        <h2 className="text-xs font-semibold text-zinc-600">{title}</h2>
      </header>
      {total === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-zinc-500">Belum ada nomor yang ditangani.</p>
      ) : (
        // Data berubah (brand/tanggal) = pasang ulang, jadi animasi menggambar diputar lagi.
        <DonutBody key={slices.map((s) => `${s.key}:${s.value}`).join('|')} title={title} count={count} slices={slices} total={total} />
      )}
    </section>
  );
}

function DonutBody({ title, count, slices, total }: { title: string; count: number; slices: Slice[]; total: number }) {
  const [drawn, setDrawn] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  // Posisi tooltip (px, relatif ke kotak donut); null = tooltip tidak tampil (mis. fokus dari legenda).
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Irisan tumbuh dari 0 setelah frame pertama; pengguna "kurangi gerakan" langsung melihat hasil akhir (globals.css).
  useEffect(() => {
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const pointAt = (event: ReactPointerEvent | ReactMouseEvent) => {
    const box = boxRef.current?.getBoundingClientRect();
    return box ? { x: event.clientX - box.left, y: event.clientY - box.top } : null;
  };
  const clear = () => { setActive(null); setTip(null); };
  const activeSlice = slices.find((s) => s.key === active) ?? null;

  let offset = 0;
  return (
    <div className="flex flex-col items-center gap-4 px-4 py-4 sm:flex-row sm:items-center">
      <div
        ref={boxRef}
        className="relative h-36 w-36 shrink-0"
        // Ketuk di luar irisan (layar sentuh) menutup tooltip.
        onClick={(event) => { if (event.target === event.currentTarget) clear(); }}
      >
        <svg viewBox="0 0 42 42" className="h-full w-full" role="img" aria-label={`${title}: ${slices.map((s) => `${s.label} ${num(s.value)}`).join(', ')}`}>
          <circle cx="21" cy="21" r={RADIUS} fill="none" stroke="#f4f4f5" strokeWidth="6" onClick={clear} />
          {slices.map((s, index) => {
            const share = (s.value / total) * 100;
            // Celah tipis antar irisan; irisan tunggal tetap utuh.
            const length = slices.length > 1 ? Math.max(share - 0.6, 0.4) : share;
            const isActive = active === s.key;
            const circle = (
              <circle
                key={s.key}
                cx="21" cy="21" r={RADIUS} fill="none" stroke={s.color}
                strokeWidth={isActive ? 7.5 : 6}
                strokeDasharray={drawn ? `${length} ${100 - length}` : `0 100`}
                strokeDashoffset={25 - offset}
                className="cursor-pointer"
                style={{
                  opacity: active && !isActive ? 0.35 : 1,
                  transition: `stroke-dasharray 700ms cubic-bezier(0.22, 1, 0.36, 1) ${index * 70}ms, stroke-width 150ms ease-out, opacity 150ms ease-out`,
                }}
                onPointerEnter={(event) => { setActive(s.key); setTip(pointAt(event)); }}
                onPointerMove={(event) => { if (event.pointerType === 'mouse') setTip(pointAt(event)); }}
                // Sentuhan: tooltip tetap tampil setelah jari diangkat, ditutup ketuk di tempat lain.
                onPointerLeave={(event) => { if (event.pointerType === 'mouse') clear(); }}
                onClick={(event) => { setActive(s.key); setTip(pointAt(event)); }}
              />
            );
            offset += share;
            return circle;
          })}
        </svg>
        {/* Label tengah sebagai HTML: ukuran teks mengikuti aturan desain, tidak ikut skala viewBox. */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums leading-none text-zinc-950">{num(activeSlice?.value ?? count)}</span>
          <span className="mt-1 text-xs text-zinc-500">{activeSlice ? `${sharePct(activeSlice.value, total)}%` : 'nomor'}</span>
        </span>
        {activeSlice && tip && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-lg bg-zinc-950 px-2.5 py-1.5 text-xs text-white shadow-lg"
            style={{ left: tip.x, top: tip.y }}
          >
            <span className="flex items-center gap-1.5 font-semibold">
              <span aria-hidden="true" className="h-2 w-2 rounded-sm" style={{ backgroundColor: activeSlice.color }} />
              {activeSlice.label}
            </span>
            <span className="tabular-nums text-zinc-300">{num(activeSlice.value)} nomor · {sharePct(activeSlice.value, total)}%</span>
          </div>
        )}
      </div>
      <ul className="w-full min-w-0 space-y-0.5 text-sm" onMouseLeave={clear}>
        {slices.map((s) => (
          <li key={s.key}>
            {/* Legenda ikut menyorot irisan (arahkan, fokus keyboard, atau ketuk). */}
            <button
              type="button"
              className={cn('flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors', active === s.key ? 'bg-zinc-100' : 'hover:bg-zinc-50')}
              onMouseEnter={() => { setActive(s.key); setTip(null); }}
              onFocus={() => { setActive(s.key); setTip(null); }}
              onBlur={clear}
              // Bukan toggle: mouse sudah mengaktifkan saat diarahkan. Sorotan hilang saat kursor keluar atau fokus pindah.
              onClick={() => { setActive(s.key); setTip(null); }}
              aria-pressed={active === s.key}
            >
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} />
              <span className={cn('min-w-0 flex-1 truncate', s.key === LEAD_PHONE_KEY || s.key === OTHERS_KEY ? 'text-zinc-500' : 'text-zinc-800')}>{s.label}</span>
              <span className="whitespace-nowrap tabular-nums text-zinc-950">{num(s.value)}</span>
              <span className="w-11 whitespace-nowrap text-right tabular-nums text-xs text-zinc-500">{sharePct(s.value, total)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LeadsView({ data, currentUserId }: { data: LeadHandlingReport; currentUserId?: number }) {
  return (
    <>
      <div className="grid gap-5 lg:grid-cols-2">
        <Donut title={`Lead baru ditangani · ${num(data.totals.newLeads)}`} count={data.totals.newLeads} slices={leadSlices(data.rows, 'newLeads')} />
        <Donut title={`Lead lama ditangani · ${num(data.totals.oldLeads)}`} count={data.totals.oldLeads} slices={leadSlices(data.rows, 'oldLeads')} />
      </div>
      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <header className="border-b border-zinc-200 bg-zinc-50/75 px-4 py-2.5">
          <h2 className="text-xs font-semibold text-zinc-600">Lead ditangani per CS</h2>
        </header>
        {data.rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-zinc-500">Belum ada CS pada brand ini.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-xs text-zinc-500">
                  <th scope="col" className="px-3 py-2 text-left font-medium sm:px-4">CS</th>
                  {/* Layar HP: judul kolom pendek agar keempat kolom muat tanpa geser. */}
                  <th scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium sm:px-4 max-sm:px-2"><span className="sm:hidden">Baru</span><span className="hidden sm:inline">Lead baru</span></th>
                  <th scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium sm:px-4 max-sm:px-2"><span className="sm:hidden">Lama</span><span className="hidden sm:inline">Lead lama</span></th>
                  <th scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium sm:px-4 max-sm:px-2"><span className="sm:hidden">Balas</span><span className="hidden sm:inline">Balas pertama</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.rows.map((r) => (
                  <tr key={r.key} className={cn(r.userId !== null && r.userId === currentUserId && 'bg-zinc-50')}>
                    <td className={cn('max-w-[9rem] truncate whitespace-nowrap py-2.5 pl-3 pr-2 sm:max-w-none sm:px-4', r.key === LEAD_PHONE_KEY ? 'text-zinc-500' : 'font-medium text-zinc-800', !r.isActive && 'text-zinc-500')}>
                      {r.name}{!r.isActive && ' (nonaktif)'}{r.userId !== null && r.userId === currentUserId && <span className="ml-1.5 text-xs font-normal text-zinc-500">(Anda)</span>}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-zinc-800 sm:px-4">{num(r.newLeads)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-zinc-800 sm:px-4">{num(r.oldLeads)}</td>
                    <td className="whitespace-nowrap py-2.5 pl-2 pr-3 text-right tabular-nums text-zinc-800 sm:px-4">{replyText(r.medianReplyMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-xs text-zinc-500">
        Dihitung per nomor per hari. Lead baru = nomor yang belum pernah dibalas sebelum hari itu; lead lama = sudah pernah dibalas.
        Chat yang diketik langsung di HP tidak tercatat atas nama CS dan masuk baris “Dari HP”. Balas pertama = median waktu balas ke lead baru.
        Nomor yang dichat dua CS pada hari yang sama masuk di baris kedua CS, tetapi total menghitungnya sekali.
      </p>
    </>
  );
}

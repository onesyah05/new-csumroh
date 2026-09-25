import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Plus, Trash2, X } from 'lucide-react';
import { CUSTOM_ADD_ONS, CUSTOM_MODES, customExtendNights, customTotalNights, isPackageDeparted, type CustomRequestInput } from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { Select } from '../../components/ui/select';
import { cn } from '../../lib/cn';
import { MoneyInput } from './MoneyInput';
import { packageServices, type CustomRequest } from './customApi';
import { onRovingKey, rovingTabIndex } from './roving';
import { CustomSpecGroups } from './CustomSpecGroups';
import { waDate } from '../chat/waFormat';

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section role="group" aria-label={title} className="space-y-2.5 border-t border-zinc-100 pt-4 first:border-t-0 first:pt-0">
    <div>
      <h3 className="text-sm font-semibold text-zinc-950">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
    </div>
    {children}
  </section>;
}
function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <label className={cn('block', className)}><span className="mb-1 block text-xs font-medium text-zinc-700">{label}</span>{children}</label>;
}
/** Pilihan dua/tiga nilai sebagai tombol (bukan native select). */
function Segmented<T extends string>({ value, options, onChange, label }: { value: T | null; options: readonly { value: T; label: string }[]; onChange(value: T | null): void; label: string }) {
  const values = options.map((option) => option.value);
  return <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-zinc-200 p-0.5" onKeyDown={(e) => onRovingKey(e, values, value, onChange)}>
    {options.map((option) => <button key={option.value} type="button" role="radio" aria-checked={value === option.value} tabIndex={rovingTabIndex(option.value, value, values[0])}
      onClick={() => onChange(value === option.value ? null : option.value)}
      className={cn('rounded-md px-3 py-1.5 text-xs font-semibold transition', value === option.value ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-100')}>{option.label}</button>)}
  </div>;
}
function Toggle({ checked, onChange, children }: { checked: boolean; onChange(value: boolean): void; children: ReactNode }) {
  return <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
    className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition', checked ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 text-zinc-700 hover:border-zinc-400')}>{children}</button>;
}
const count = (value: string) => Math.max(0, Math.min(200, Number(value.replace(/\D/g, '')) || 0));
const nightsOf = (value: string) => (value === '' ? null : Math.min(60, Number(value.replace(/\D/g, '')) || 0));

type FormPackage = {
  id: number; name: string; isActive?: boolean; departureDate?: string | null; departureInfo?: string | null; duration?: string | null;
  airline?: string | null; flightType?: string | null; hotelMakkah?: string | null; hotelMadinah?: string | null; quotaRemaining?: number | null;
  facilitiesIncluded?: string | null;
};

/**
 * Form kebutuhan layanan custom (template lapangan). Langkah pertama memilih jenis:
 * - Berbasis paket: tanggal & pesawat mengikuti paket; CS hanya mencatat perubahannya (extend, ganti hotel, layanan).
 * - Full custom: semua komponen dari kebutuhan jamaah.
 * Nama, nomor, brand, dan PIC diambil dari prospek. Jumlah jamaah di sini menjadi jumlah jamaah prospek.
 */
export function CustomRequestForm({ open, onClose, prospectId, brandId, initial, existing, packages, openInvoice = null, onSaved }: {
  open: boolean; onClose(): void; prospectId: number; brandId?: number; initial: CustomRequestInput; existing?: CustomRequest | null;
  packages: FormPackage[];
  /** Nomor invoice yang sudah terkirim ke jamaah; dibatalkan bila harga dihitung ulang. */
  openInvoice?: string | null;
  onSaved(message: string): void;
}) {
  const [form, setForm] = useState<CustomRequestInput>(initial);
  // Permintaan baru mulai dari pilihan jenis; mengubah permintaan langsung ke isian.
  const [chosen, setChosen] = useState(Boolean(existing));
  const [dateMode, setDateMode] = useState<'exact' | 'range'>(initial.departureDateTo ? 'range' : 'exact');
  const [otherService, setOtherService] = useState('');
  // Langkah terakhir: periksa ringkasan seperti yang dibaca Tim LA sebelum dikirim.
  const [reviewing, setReviewing] = useState(false);
  const [revisionNote, setRevisionNote] = useState('');
  const requote = Boolean(existing && (existing.status === 'quoted' || existing.status === 'agreed'));
  const resend = existing?.status === 'needs_info';
  const set = <K extends keyof CustomRequestInput>(key: K, value: CustomRequestInput[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form, basePackageId: form.mode === 'package' ? form.basePackageId : null, departureDateTo: dateMode === 'range' ? form.departureDateTo : null, brandId,
        ...(requote && revisionNote.trim() ? { revisionNote: revisionNote.trim() } : {}),
        ...(requote && openInvoice ? { voidInvoice: true } : {}),
      };
      return existing
        ? api.patch<CustomRequest>(`/custom-requests/${existing.id}`, body)
        : api.post<CustomRequest>(`/custom-requests/prospect/${prospectId}`, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['prospect', prospectId] });
      onSaved(requote ? 'Kebutuhan diubah; Tim LA menghitung ulang.' : resend ? 'Kebutuhan dilengkapi dan dikirim ulang ke Tim LA.' : existing ? 'Kebutuhan custom diperbarui.' : 'Kebutuhan dikirim ke Tim LA untuk dihitung.');
      onClose();
    },
  });
  const packageMode = form.mode === 'package';
  const activePackages = packages.filter((pkg) => pkg.isActive !== false && !isPackageDeparted(pkg));
  const base = packages.find((pkg) => pkg.id === form.basePackageId) ?? null;
  const adults = form.paxQuad + form.paxTriple + form.paxDouble;
  const badExtraRows = form.extraHotels.map((row, index) => (!row.country.trim() || !(row.nights > 0) ? index : -1)).filter((index) => index >= 0);
  const missing = [
    packageMode && !form.basePackageId && 'paket dasar',
    adults < 1 && 'minimal 1 jamaah dewasa',
    !packageMode && !form.departureDate && (dateMode === 'range' ? 'tanggal awal rentang' : 'tanggal keberangkatan'),
    !packageMode && dateMode === 'range' && (!form.departureDateTo || (form.departureDate && form.departureDateTo < form.departureDate)) && 'tanggal akhir rentang',
    // Tim LA tidak bisa menghitung hotel tanpa jumlah malam (isi 0 bila memang tidak menginap).
    !packageMode && (form.nightsMakkah === null || form.nightsMakkah === undefined) && 'malam Makkah',
    !packageMode && (form.nightsMadinah === null || form.nightsMadinah === undefined) && 'malam Madinah',
    badExtraRows.length > 0 && 'negara & malam tambahan',
  ].filter(Boolean);
  const extraRows = <>
    {form.extraHotels.map((row, index) => <div key={index} className="grid gap-2 sm:grid-cols-[9rem_1fr_7rem_auto] sm:items-end">
      <Field label="Negara tambahan"><input className={cn('field', badExtraRows.includes(index) && !row.country.trim() && 'border-rose-400')} aria-invalid={badExtraRows.includes(index) && !row.country.trim() || undefined} maxLength={60} placeholder="Mis. Turki" value={row.country} onChange={(e) => set('extraHotels', form.extraHotels.map((r, i) => (i === index ? { ...r, country: e.target.value } : r)))} /></Field>
      <Field label="Hotel"><input className="field" maxLength={150} value={row.hotel ?? ''} onChange={(e) => set('extraHotels', form.extraHotels.map((r, i) => (i === index ? { ...r, hotel: e.target.value } : r)))} /></Field>
      <Field label="Malam"><input inputMode="numeric" aria-label={`Malam di ${row.country || 'negara tambahan'}`} className={cn('field tabular-nums', !(row.nights > 0) && 'border-rose-400')} value={row.nights || ''} onChange={(e) => set('extraHotels', form.extraHotels.map((r, i) => (i === index ? { ...r, nights: count(e.target.value) } : r)))} /></Field>
      <Button size="icon" variant="ghost" aria-label="Hapus negara tambahan" onClick={() => set('extraHotels', form.extraHotels.filter((_, i) => i !== index))}><Trash2 size={15} /></Button>
    </div>)}
  </>;
  const addCountry = form.extraHotels.length < 5 && <button type="button" onClick={() => set('extraHotels', [...form.extraHotels, { country: '', hotel: '', nights: 1 }])} className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-900 hover:underline"><Plus size={13} />Tambah negara (umroh plus)</button>;
  const paxSection = <Section title="Jamaah" hint="Jumlah ini menjadi jumlah jamaah prospek dan dasar hitungan Tim LA.">
    <div className="grid grid-cols-4 gap-2">
      {([['paxQuad', 'Quad'], ['paxTriple', 'Triple'], ['paxDouble', 'Double'], ['paxInfant', 'Bayi']] as const).map(([key, label]) =>
        <Field key={key} label={label}><input inputMode="numeric" aria-label={`Jamaah ${label}`} className="field tabular-nums" value={form[key] || ''} placeholder="0" onChange={(e) => set(key, count(e.target.value))} /></Field>)}
    </div>
  </Section>;
  // Berbasis paket: layanan = daftar "Sudah termasuk" paket (hapus centang = dikurangi) + tambahan.
  const included = packageServices(base);
  const has = (list: string[], item: string) => list.some((value) => value.toLowerCase() === item.toLowerCase());
  const toggleIn = (key: 'servicesRemoved' | 'servicesAdded', item: string) =>
    set(key, has(form[key], item) ? form[key].filter((value) => value.toLowerCase() !== item.toLowerCase()) : [...form[key], item]);
  // Ejaan di katalog beragam (muthawif/muthowif, TL/tour leader): tambahan yang sudah ada di paket tidak ditawarkan lagi.
  const aliases: Record<string, RegExp> = {
    'Kereta cepat': /kereta\s*cepat|haramain/i, Perlengkapan: /perlengkapan/i, 'Tour leader': /tour\s*leader|\btl\b/i, Muthowif: /mut(h)?[ao]w?if/i,
  };
  const quickAdds = CUSTOM_ADD_ONS.filter((item) => !included.some((line) => aliases[item]!.test(line)));
  const customAdds = form.servicesAdded.filter((item) => !has([...CUSTOM_ADD_ONS], item));
  const addOther = () => {
    const value = otherService.trim();
    if (value && !has(form.servicesAdded, value)) set('servicesAdded', [...form.servicesAdded, value]);
    setOtherService('');
  };
  const packageServiceSection = <Section title="Layanan" hint="Hapus centang layanan paket yang tidak diambil jamaah, lalu pilih tambahannya.">
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-zinc-700">Layanan dari paket</p>
      {included.length ? <ul className="grid gap-1 sm:grid-cols-2">
        {included.map((item) => {
          const removed = has(form.servicesRemoved, item);
          return <li key={item}><label className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-zinc-50">
            <input type="checkbox" className="mt-0.5 accent-zinc-900" checked={!removed} onChange={() => toggleIn('servicesRemoved', item)} />
            <span className={cn(removed ? 'text-zinc-400 line-through' : 'text-zinc-800')}>{item}</span>
          </label></li>;
        })}
      </ul> : <p className="text-xs text-zinc-500">{base ? 'Paket ini belum punya daftar "Sudah termasuk" di katalog. Tulis pengurangan layanan di catatan.' : 'Pilih paket dasar untuk melihat layanannya.'}</p>}
    </div>
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-zinc-700">Tambah layanan</p>
      <div className="flex flex-wrap gap-2">
        {quickAdds.map((item) => <Toggle key={item} checked={has(form.servicesAdded, item)} onChange={() => toggleIn('servicesAdded', item)}>{item}</Toggle>)}
        {customAdds.map((item) => <button key={item} type="button" onClick={() => toggleIn('servicesAdded', item)} aria-label={`Hapus ${item}`}
          className="inline-flex items-center gap-1 rounded-full border border-zinc-900 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white">{item}<X size={12} aria-hidden="true" /></button>)}
      </div>
      <div className="flex gap-2">
        <input className="field" maxLength={150} placeholder="Layanan lain, mis. handling bandara VIP" value={otherService}
          onChange={(e) => setOtherService(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOther(); } }} />
        <Button variant="secondary" disabled={!otherService.trim()} onClick={addOther}>Tambah</Button>
      </div>
    </div>
    {(form.servicesRemoved.length > 0 || form.servicesAdded.length > 0) && <p className="text-xs text-zinc-600">
      {[form.servicesRemoved.length > 0 && `Dikurangi ${form.servicesRemoved.length}`, form.servicesAdded.length > 0 && `Ditambah ${form.servicesAdded.length}`].filter(Boolean).join(' · ')}
    </p>}
    <Field label="City tour tambahan"><textarea rows={2} maxLength={2000} className="field h-auto resize-none py-2" placeholder="Mis. Thaif, museum wahyu" value={form.cityTour ?? ''} onChange={(e) => set('cityTour', e.target.value || null)} /></Field>
  </Section>;
  const serviceSection = <Section title="Layanan" hint="City tour standar Makkah & Madinah sudah termasuk.">
    <div className="flex flex-wrap gap-2">
      <Toggle checked={form.fastTrain === true} onChange={(v) => set('fastTrain', v)}>Kereta cepat</Toggle>
      <Toggle checked={form.equipment === true} onChange={(v) => set('equipment', v)}>Perlengkapan</Toggle>
      <Toggle checked={form.tourLeader === true} onChange={(v) => set('tourLeader', v)}>Tour leader</Toggle>
      <Toggle checked={form.muthawif === true} onChange={(v) => set('muthawif', v)}>Muthowif</Toggle>
    </div>
    <Field label="City tour tambahan"><textarea rows={2} maxLength={2000} className="field h-auto resize-none py-2" placeholder="Mis. Thaif, museum wahyu" value={form.cityTour ?? ''} onChange={(e) => set('cityTour', e.target.value || null)} /></Field>
  </Section>;
  const notesSection = <Section title="Budget & catatan">
    <Field label="Budget per orang" className="sm:max-w-xs"><MoneyInput aria-label="Budget per orang" value={form.budgetPerPax ?? null} onChange={(v) => set('budgetPerPax', v)} placeholder="Mis. 35.000.000" /></Field>
    <Field label="Kebutuhan khusus"><textarea rows={2} maxLength={2000} className="field h-auto resize-none py-2" placeholder="Mis. lansia, kursi roda, anak" value={form.specialNeeds ?? ''} onChange={(e) => set('specialNeeds', e.target.value || null)} /></Field>
    <Field label="Catatan untuk Tim LA"><textarea rows={2} maxLength={2000} className="field h-auto resize-none py-2" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} /></Field>
  </Section>;
  const modeLabel = CUSTOM_MODES.find((item) => item.value === form.mode)?.label;

  const submitLabel = requote && openInvoice ? 'Batalkan invoice & minta hitung ulang' : requote ? 'Simpan & minta hitung ulang' : resend ? 'Kirim ulang ke Tim LA' : existing ? 'Simpan perubahan' : 'Kirim ke Tim LA';
  const preview = {
    ...form, id: existing?.id ?? 0, status: 'submitted', basePackage: base,
    departureDate: packageMode ? base?.departureDate ?? null : form.departureDate, departureDateTo: !packageMode && dateMode === 'range' ? form.departureDateTo : null,
  } as unknown as CustomRequest;

  return <Modal open={open} onClose={onClose} size="xl" title={reviewing ? 'Periksa sebelum dikirim' : existing ? 'Ubah kebutuhan layanan custom' : 'Layanan custom'}
    description={chosen ? <>Jenis: <b className="font-semibold text-zinc-900">{modeLabel}</b>{!existing && <> · <button type="button" onClick={() => setChosen(false)} className="font-semibold text-zinc-900 underline">Ganti jenis</button></>}</>
      : 'Pilih jenis permintaan. Tim LA menghitung harga ditawarkan, harga terendah, dan DP minimal.'}
    footer={reviewing ? <>
      <Button variant="secondary" onClick={() => setReviewing(false)}>Kembali ubah</Button>
      <Button loading={save.isPending} onClick={() => save.mutate()}>{submitLabel}</Button>
    </> : chosen ? <>
      {missing.length > 0 && <p className="mr-auto text-xs text-zinc-600">Lengkapi: {missing.join(', ')}.</p>}
      <Button variant="secondary" onClick={onClose}>Batal</Button>
      <Button disabled={missing.length > 0} onClick={() => setReviewing(true)}>Periksa</Button>
    </> : <>
      <Button variant="secondary" onClick={onClose}>Batal</Button>
      <Button onClick={() => setChosen(true)}>Lanjut</Button>
    </>}>
    {reviewing ? (
      <div className="space-y-4">
        {requote && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Harga yang sudah dihitung{existing?.status === 'agreed' ? ' dan nilai deal yang disepakati' : ''} akan dibatalkan. Tim LA menghitung ulang berdasarkan kebutuhan ini.</p>}
        {requote && openInvoice && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800"><b className="font-semibold">Invoice {openInvoice} ikut dibatalkan.</b> Beri tahu jamaah agar tidak mentransfer sesuai invoice itu; invoice baru dikirim setelah harga baru disepakati.</p>}
        {resend && existing?.returnNote && <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-700">Diminta Tim LA: {existing.returnNote}</p>}
        <CustomSpecGroups request={preview} basePackage={base ? { ...base, departureDate: base.departureDate ?? null } : null} />
        {requote && <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-700">Pesan untuk Tim LA (opsional)</span>
          <textarea rows={2} maxLength={1000} value={revisionNote} onChange={(e) => setRevisionNote(e.target.value)} className="field h-auto resize-none py-2" placeholder="Mis. jamaah minta hotel lebih dekat" />
          <span className="mt-1 block text-xs text-zinc-500">Ringkasan perubahan (nilai lama → baru) dikirim otomatis.</span>
        </label>}
        {save.error && <p role="alert" className="text-xs text-rose-700">{save.error.message}</p>}
      </div>
    ) : !chosen ? (
      <div role="radiogroup" aria-label="Jenis layanan custom" className="grid gap-3 sm:grid-cols-2" onKeyDown={(e) => onRovingKey(e, CUSTOM_MODES.map((m) => m.value), form.mode, (v) => set('mode', v))}>
        {CUSTOM_MODES.map((item) => {
          const active = form.mode === item.value;
          return <button key={item.value} type="button" role="radio" aria-checked={active} tabIndex={active ? 0 : -1} onClick={() => set('mode', item.value)}
            className={cn('rounded-xl border p-4 text-left transition', active ? 'border-zinc-900 ring-1 ring-zinc-900' : 'border-zinc-200 hover:border-zinc-400')}>
            <span className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
              <span aria-hidden="true" className={cn('grid h-4 w-4 place-items-center rounded-full border', active ? 'border-zinc-900' : 'border-zinc-300')}>{active && <span className="h-2 w-2 rounded-full bg-zinc-900" />}</span>
              {item.label}
            </span>
            <span className="mt-1.5 block text-xs leading-relaxed text-zinc-600">{item.description}</span>
          </button>;
        })}
      </div>
    ) : packageMode ? (
      <div className="space-y-5">
        <Section title="Paket dasar" hint="Tanggal berangkat dan pesawat mengikuti paket. Kuota paket ini dipotong saat Deal.">
          <Select aria-label="Paket dasar" className="w-full" placeholder="Pilih paket" value={form.basePackageId ? String(form.basePackageId) : undefined}
            onValueChange={(v) => set('basePackageId', Number(v))}
            options={activePackages.map((pkg) => ({ value: String(pkg.id), label: pkg.name }))} />
          {base && <dl className="grid gap-x-6 gap-y-0.5 rounded-lg bg-zinc-50 px-3 py-2.5 text-xs sm:grid-cols-2">
            {([
              ['Berangkat', [waDate(base.departureDate) ?? base.departureInfo, base.duration].filter(Boolean).join(' · ')],
              ['Pesawat', [base.airline, base.flightType === 'direct' ? 'Direct' : base.flightType === 'transit' ? 'Transit' : null].filter(Boolean).join(' · ')],
              ['Hotel Makkah', base.hotelMakkah],
              ['Hotel Madinah', base.hotelMadinah],
              ['Sisa kuota', base.quotaRemaining != null ? `${base.quotaRemaining} orang` : null],
            ] as const).filter(([, value]) => value).map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="shrink-0 text-zinc-600">{label}</dt><dd className="min-w-0 text-right font-medium text-zinc-900">{value}</dd></div>)}
          </dl>}
        </Section>
        {paxSection}
        <Section title="Yang diubah dari paket" hint="Kosongkan bagian yang tetap sesuai paket.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Extend Makkah (tambah malam)"><input inputMode="numeric" aria-label="Extend malam di Makkah" className="field tabular-nums" placeholder="0" value={form.extendNightsMakkah || ''} onChange={(e) => set('extendNightsMakkah', nightsOf(e.target.value) || null)} /></Field>
            <Field label="Extend Madinah (tambah malam)"><input inputMode="numeric" aria-label="Extend malam di Madinah" className="field tabular-nums" placeholder="0" value={form.extendNightsMadinah || ''} onChange={(e) => set('extendNightsMadinah', nightsOf(e.target.value) || null)} /></Field>
            <Field label="Ganti hotel Makkah"><input className="field" maxLength={150} placeholder={base?.hotelMakkah ? `Sesuai paket: ${base.hotelMakkah}` : 'Kosongkan bila sesuai paket'} value={form.hotelMakkah ?? ''} onChange={(e) => set('hotelMakkah', e.target.value || null)} /></Field>
            <Field label="Ganti hotel Madinah"><input className="field" maxLength={150} placeholder={base?.hotelMadinah ? `Sesuai paket: ${base.hotelMadinah}` : 'Kosongkan bila sesuai paket'} value={form.hotelMadinah ?? ''} onChange={(e) => set('hotelMadinah', e.target.value || null)} /></Field>
          </div>
          {extraRows}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {addCountry}
            {customExtendNights(form) > 0 && <span className="text-xs text-zinc-600">Tambahan <b className="font-semibold text-zinc-900">{customExtendNights(form)} malam</b> dari durasi paket</span>}
          </div>
        </Section>
        {packageServiceSection}
        {notesSection}
        {save.error && <p role="alert" className="text-xs text-rose-700">{save.error.message}</p>}
      </div>
    ) : (
      <div className="space-y-5">
        <Section title="Jadwal & penerbangan">
          <Segmented label="Jenis tanggal keberangkatan" value={dateMode} onChange={(v) => setDateMode(v ?? dateMode)}
            options={[{ value: 'exact', label: 'Tanggal pasti' }, { value: 'range', label: 'Rentang tanggal' }] as const} />
          <div className="grid gap-3 sm:grid-cols-2">
            {dateMode === 'exact'
              ? <Field label="Tanggal keberangkatan"><input type="date" className="field" value={form.departureDate ?? ''} onChange={(e) => set('departureDate', e.target.value || null)} /></Field>
              : <div className="grid grid-cols-2 gap-2 sm:col-span-2">
                <Field label="Berangkat paling cepat"><input type="date" className="field" value={form.departureDate ?? ''} onChange={(e) => set('departureDate', e.target.value || null)} /></Field>
                <Field label="Berangkat paling lambat"><input type="date" className="field" min={form.departureDate ?? undefined} value={form.departureDateTo ?? ''} onChange={(e) => set('departureDateTo', e.target.value || null)} /></Field>
              </div>}
            <Field label="Kota / bandara keberangkatan"><input className="field" maxLength={100} placeholder="Mis. Jakarta (CGK)" value={form.departureCity ?? ''} onChange={(e) => set('departureCity', e.target.value || null)} /></Field>
            <Field label="Maskapai pilihan"><input className="field" maxLength={100} placeholder="Kosongkan bila bebas" value={form.airline ?? ''} onChange={(e) => set('airline', e.target.value || null)} /></Field>
          </div>
          <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium text-zinc-700">Penerbangan</span>
            <Segmented label="Jenis penerbangan" value={form.flightType ?? null} onChange={(v) => set('flightType', v)} options={[{ value: 'direct', label: 'Direct' }, { value: 'transit', label: 'Transit' }] as const} />
          </div>
        </Section>
        {paxSection}
        <Section title="Hotel & rute">
          <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
            <Field label="Hotel Makkah"><input className="field" maxLength={150} placeholder="Nama hotel, atau mis. setara bintang 5 dekat Masjidil Haram" value={form.hotelMakkah ?? ''} onChange={(e) => set('hotelMakkah', e.target.value || null)} /></Field>
            <Field label="Malam"><input inputMode="numeric" aria-label="Malam di Makkah" className="field tabular-nums" value={form.nightsMakkah ?? ''} onChange={(e) => set('nightsMakkah', nightsOf(e.target.value))} /></Field>
            <Field label="Hotel Madinah"><input className="field" maxLength={150} placeholder="Nama hotel atau kriteria" value={form.hotelMadinah ?? ''} onChange={(e) => set('hotelMadinah', e.target.value || null)} /></Field>
            <Field label="Malam"><input inputMode="numeric" aria-label="Malam di Madinah" className="field tabular-nums" value={form.nightsMadinah ?? ''} onChange={(e) => set('nightsMadinah', nightsOf(e.target.value))} /></Field>
          </div>
          {extraRows}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {addCountry}
            <span className="text-xs text-zinc-600">Total <b className="font-semibold text-zinc-900">{customTotalNights(form)} malam</b></span>
          </div>
          <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium text-zinc-700">Rute</span>
            <Segmented label="Rute" value={form.route ?? null} onChange={(v) => set('route', v)} options={[{ value: 'makkah_first', label: 'Makkah dulu' }, { value: 'madinah_first', label: 'Madinah dulu' }] as const} />
          </div>
        </Section>
        {serviceSection}
        {notesSection}
        {save.error && <p role="alert" className="text-xs text-rose-700">{save.error.message}</p>}
      </div>
    )}
  </Modal>;
}

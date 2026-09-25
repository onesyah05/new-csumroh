import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, Clock3, ImageIcon, Plane, Undo2 } from 'lucide-react';
import { customDisplayStatus, customHoursLeft, customStatusLabel } from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/modal';
import { cn } from '../../lib/cn';
import { MoneyInput } from './MoneyInput';
import { RoomPriceTable } from './RoomPriceTable';
import { CustomSpecGroups } from './CustomSpecGroups';
import { minDpTotal, money, sinceLabel, timeLeftLabel, validUntilLabel, type CustomRequest } from './customApi';

/**
 * Layanan custom di tab Paket (CS): status hitungan Tim LA, harga per tipe kamar, masa berlaku, dan nilai deal akhir.
 * Aksi tahap (penawaran, invoice, bukti) tetap di `footer`.
 */
export function CustomRequestPanel({ request, prospectId, readOnly, proofSubmitted = false, progress, baseActions, onEdit, onShowToast, footer }: {
  request: CustomRequest; prospectId: number; readOnly: boolean; proofSubmitted?: boolean;
  /** Tahap prospek setelah harga disepakati: menentukan petunjuk langkah berikutnya. */
  progress?: { offerSent: boolean; invoiceSent: boolean; won: boolean };
  /** Custom berbasis paket: bahan jualan paket dasar yang tetap bisa dikirim ke chat. */
  baseActions?: { name: string; onSendFlyer?: () => void; onInsertItinerary?: () => void };
  onEdit(): void; onShowToast(message: string): void; footer?: ReactNode;
}) {
  const status = customDisplayStatus(request);
  // Nilai deal sengaja kosong: diisi setelah benar-benar ada kesepakatan dengan jamaah.
  const [price, setPrice] = useState<number | null>(request.agreedPrice ? Number(request.agreedPrice) : null);
  const [specOpen, setSpecOpen] = useState(status === 'submitted' || status === 'revision_requested' || status === 'needs_info');
  const [dialog, setDialog] = useState<'revision' | 'cancel' | null>(null);
  const [note, setNote] = useState('');
  const [confirmHigh, setConfirmHigh] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['prospect', prospectId] });
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body: Record<string, unknown> }) => api.post<CustomRequest>(`/custom-requests/${request.id}/${path}`, body),
    onSuccess: (_, { path }) => {
      refresh();
      setDialog(null); setNote('');
      onShowToast(path === 'agree' ? 'Nilai deal custom disepakati.' : path === 'revision' ? 'Diminta hitung ulang ke Tim LA.' : 'Layanan custom dibatalkan.');
    },
  });
  const floor = Number(request.floorPrice ?? 0);
  const offered = Number(request.offeredPrice ?? 0);
  const belowFloor = price !== null && price < floor;
  const discount = price !== null && price < offered ? offered - price : 0;
  const quoted = status === 'quoted' || status === 'agreed' || status === 'expired';
  const waiting = status === 'submitted' || status === 'revision_requested';
  const hoursLeft = status === 'quoted' ? customHoursLeft(request.quoteValidUntil) : null;
  const urgent = hoursLeft !== null && hoursLeft < 24;
  const canEdit = !readOnly && !(quoted && proofSubmitted);

  return <div className="space-y-3">
    <div className="min-w-0">
      <h3 className="text-sm font-semibold text-zinc-950">Layanan custom</h3>
      <p className={cn('mt-0.5 inline-flex items-center gap-1 text-xs font-semibold',
        status === 'agreed' ? 'text-emerald-800' : status === 'expired' || status === 'needs_info' ? 'text-amber-800' : waiting ? 'text-zinc-700' : 'text-zinc-900')}>
        {waiting && <Clock3 size={12} aria-hidden="true" />}
        {(status === 'expired' || status === 'needs_info') && <AlertTriangle size={12} aria-hidden="true" />}
        {customStatusLabel(status, 'cs')}{waiting ? ` · ${sinceLabel(request.queuedAt ?? request.createdAt)}` : ''}
      </p>
    </div>

    {status === 'needs_info' && <div role="alert" className="space-y-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
      <p className="flex gap-1.5"><Undo2 size={13} className="mt-0.5 shrink-0" aria-hidden="true" /><span><b className="font-semibold">Dikembalikan Tim LA:</b> {request.returnNote}</span></p>
      {!readOnly && <Button size="sm" onClick={onEdit}>Lengkapi & kirim ulang</Button>}
    </div>}
    {status === 'revision_requested' && request.revisionNote && <p className="whitespace-pre-line text-xs text-zinc-600">Alasan hitung ulang: {request.revisionNote}</p>}

    {quoted && <section aria-label="Harga Tim LA" className="space-y-1.5 rounded-lg bg-zinc-50 px-3 py-2.5 text-xs">
      {request.quoteCount > 1 && request.quotedAt && <p className="font-semibold text-zinc-900">Harga diperbarui Tim LA · {validUntilLabel(request.quotedAt)}</p>}
      <RoomPriceTable request={request} />
      <p className="text-zinc-500">Kolom terendah hanya untuk internal, tidak dikirim ke jamaah.</p>
      <p className="flex justify-between gap-2 border-t border-zinc-200 pt-1.5">
        <span className="shrink-0 text-zinc-600">DP minimal</span>
        <span className="text-right tabular-nums text-zinc-900">
          {money(request.minDpPerPax)}/dewasa{request.paxInfant ? ` · ${money(request.minDpInfant ?? request.minDpPerPax)}/bayi` : ''} = <b className="font-semibold">{money(minDpTotal(request))}</b>
        </span>
      </p>
      {request.quoteValidUntil && status !== 'agreed' && <p className="flex justify-between gap-2">
        <span className="shrink-0 text-zinc-600">Berlaku sampai</span>
        <span className={cn('tabular-nums', status === 'expired' || urgent ? 'font-semibold text-amber-800' : 'text-zinc-900')}>
          {validUntilLabel(request.quoteValidUntil)}{hoursLeft !== null && hoursLeft > 0 ? ` · ${timeLeftLabel(hoursLeft)}` : ''}
        </span>
      </p>}
      {request.quoteNote && <p className="border-t border-zinc-200 pt-1.5 text-zinc-700">Catatan Tim LA: {request.quoteNote}</p>}
    </section>}

    {status === 'quoted' && !readOnly && <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={`agree-${request.id}`} className="text-xs font-semibold text-zinc-900">Nilai deal akhir (total)</label>
        <button type="button" onClick={() => setPrice(offered)} className="text-xs font-semibold text-zinc-700 hover:text-zinc-950 hover:underline">Pakai harga ditawarkan</button>
      </div>
      <div className="flex gap-2">
        <MoneyInput id={`agree-${request.id}`} className="min-w-0 flex-1" value={price} onChange={setPrice} invalid={belowFloor} placeholder="Hasil negosiasi" />
        <Button disabled={!price || belowFloor} loading={action.isPending && action.variables?.path === 'agree'}
          onClick={() => (price && price > offered * 1.1 ? setConfirmHigh(true) : action.mutate({ path: 'agree', body: { agreedPrice: price } }))}>Sepakati</Button>
      </div>
      <p className={cn('text-xs', belowFloor ? 'font-semibold text-rose-700' : 'text-zinc-500')}>
        {belowFloor ? `Di bawah harga terendah ${money(floor)}. Nilai ini tidak dapat disepakati.`
          : discount > 0 ? `Potongan ${money(discount)} (${Math.round((discount / offered) * 1000) / 10}%) dari harga ditawarkan.`
          : price && price > offered ? 'Di atas harga ditawarkan.'
          : 'Isi setelah jamaah setuju. Tidak boleh di bawah harga terendah.'}
      </p>
    </div>}
    {status === 'agreed' && <p className="text-xs text-zinc-700">Disepakati <b className="font-semibold tabular-nums text-emerald-800">{money(request.agreedPrice)}</b>. {
      progress?.won ? 'Deal; pemesanan dilanjutkan Tim LA.'
        : proofSubmitted ? 'Bukti transfer menunggu verifikasi Finance.'
        : progress?.invoiceSent ? 'Invoice terkirim; menunggu bukti transfer.'
        : progress?.offerSent ? 'Penawaran terkirim; kirim invoice minimal DP.'
        : 'Kirim penawaran resmi, lalu invoice minimal DP.'}</p>}
    {status === 'expired' && !readOnly && <p className="text-xs text-amber-800">Masa berlaku harga lewat. Minta hitung ulang sebelum menyepakati.</p>}

    <div className="border-t border-zinc-100 pt-2">
      <button type="button" aria-expanded={specOpen} onClick={() => setSpecOpen(!specOpen)} className="flex w-full items-center justify-between py-1 text-left text-xs font-semibold text-zinc-900">
        {specOpen ? 'Sembunyikan kebutuhan jamaah' : 'Lihat kebutuhan jamaah'}
        <ChevronDown size={14} aria-hidden="true" className={cn('text-zinc-500 transition-transform', specOpen && 'rotate-180')} />
      </button>
      {specOpen && <CustomSpecGroups request={request} compact className="pt-1.5" />}
    </div>

    {baseActions && (baseActions.onSendFlyer || baseActions.onInsertItinerary) && <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="mr-0.5 text-zinc-600">Paket dasar ke chat:</span>
      {baseActions.onSendFlyer && <button type="button" onClick={baseActions.onSendFlyer} aria-label={`Kirim flyer ${baseActions.name} ke chat`}
        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 font-medium text-zinc-800 hover:border-zinc-400"><ImageIcon size={12} aria-hidden="true" />Flyer</button>}
      {baseActions.onInsertItinerary && <button type="button" onClick={baseActions.onInsertItinerary} aria-label={`Sisipkan itinerary ${baseActions.name} ke chat`}
        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 font-medium text-zinc-800 hover:border-zinc-400"><Plane size={12} aria-hidden="true" />Itinerary</button>}
    </div>}

    {!readOnly && <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {canEdit && status !== 'needs_info' && <button type="button" onClick={onEdit} className="font-semibold text-zinc-900 hover:underline">Ubah kebutuhan</button>}
      {status === 'expired' && <button type="button" onClick={() => setDialog('revision')} className="font-semibold text-zinc-900 hover:underline">Minta hitung ulang</button>}
      {!(quoted && proofSubmitted) && <button type="button" onClick={() => setDialog('cancel')} className="font-semibold text-rose-700 hover:underline">Batalkan layanan custom</button>}
    </div>}
    {action.error && !dialog && <p role="alert" className="text-xs text-rose-700">{action.error.message}</p>}
    {footer}

    <ConfirmDialog open={confirmHigh} onClose={() => setConfirmHigh(false)} tone="primary" pending={action.isPending}
      onConfirm={() => { setConfirmHigh(false); action.mutate({ path: 'agree', body: { agreedPrice: price } }); }}
      title="Nilai deal di atas harga ditawarkan?" confirmLabel="Ya, sepakati"
      description={`Nilai deal ${money(price)} lebih tinggi ${Math.round(((price ?? 0) / offered - 1) * 100)}% dari harga ditawarkan ${money(offered)}. Pastikan tidak salah ketik.`} />

    <Modal open={dialog !== null} onClose={() => setDialog(null)} size="sm"
      title={dialog === 'revision' ? 'Minta hitung ulang' : 'Batalkan layanan custom?'}
      description={dialog === 'revision' ? 'Kebutuhan tetap sama; Tim LA menghitung harga yang berlaku sekarang.' : 'Prospek kembali memakai paket katalog. Riwayat tetap tersimpan.'}
      footer={<>
        <Button variant="secondary" onClick={() => setDialog(null)}>Kembali</Button>
        <Button variant={dialog === 'cancel' ? 'danger' : 'primary'} disabled={dialog === 'revision' && note.trim().length < 3} loading={action.isPending}
          onClick={() => action.mutate({ path: dialog === 'revision' ? 'revision' : 'cancel', body: { note: note.trim() || undefined } })}>
          {dialog === 'revision' ? 'Kirim ke Tim LA' : 'Batalkan'}
        </Button>
      </>}>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-700">{dialog === 'revision' ? 'Pesan untuk Tim LA' : 'Alasan (opsional)'}</span>
        <textarea rows={3} maxLength={dialog === 'revision' ? 2000 : 500} value={note} onChange={(e) => setNote(e.target.value)} className="field h-auto resize-none py-2"
          placeholder={dialog === 'revision' ? 'Mis. harga kedaluwarsa, jamaah masih berminat' : ''} />
      </label>
      {action.error && <p role="alert" className="mt-2 text-xs text-rose-700">{action.error.message}</p>}
    </Modal>
  </div>;
}

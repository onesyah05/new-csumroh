import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ChevronDown, TriangleAlert } from 'lucide-react';
import { SOSMED_SOURCES, isQualificationComplete, type SosmedSource } from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { Select } from '../../components/ui/select';
import { QualificationFields, type QualificationValue } from '../prospects/QualificationFields';

export interface NewChatBrand { id: number; name: string }

const EMPTY_QUALIFICATION: QualificationValue = {
  targetMonth: '', targetMonthsExtra: '', budgetRange: '', passportStatus: '', city: '',
  paxQuad: 0, paxTriple: 0, paxDouble: 0, paxInfant: 0,
};

const fieldLabel = 'mb-1 block text-xs font-semibold text-zinc-600';
const inputClass = 'h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-xs text-zinc-900 placeholder:text-zinc-500 shadow-xs outline-none transition focus:border-black focus:ring-1 focus:ring-black disabled:opacity-60';

type Handled = { prospectId: number; picName: string | null };

/**
 * Mulai chat ke nomor yang diberikan tim sosmed. Pembuat menjadi PIC; prospek baru hanya tersimpan bila pesan
 * pertama terkirim. Brand hanya dipilih bila akun punya lebih dari satu brand.
 */
export function NewChatModal({ open, onClose, brands, defaultBrandId, onStarted, onOpenExisting }: {
  open: boolean;
  onClose: () => void;
  /** Brand yang boleh dipakai akun ini. Satu brand = tanpa pilihan. */
  brands: NewChatBrand[];
  defaultBrandId: number | null;
  onStarted: (result: { prospectId: number; brandId: number }) => void;
  onOpenExisting: (result: { prospectId: number; brandId: number }) => void;
}) {
  const [brandId, setBrandId] = useState<number | null>(defaultBrandId ?? brands[0]?.id ?? null);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [source, setSource] = useState<SosmedSource | ''>('');
  const [notes, setNotes] = useState('');
  const [showQualification, setShowQualification] = useState(false);
  const [qualification, setQualification] = useState<QualificationValue>(EMPTY_QUALIFICATION);
  const [error, setError] = useState('');
  const [handled, setHandled] = useState<Handled | null>(null);

  const digits = phone.replace(/\D/g, '');
  const ready = Boolean(brandId && digits.length >= 8 && source);

  const start = useMutation({
    mutationFn: () => api.post<{ prospectId: number; created: boolean }>('/chat/new', {
      brandId,
      phone,
      name: name.trim() || undefined,
      source,
      notes: notes.trim() || undefined,
      targetMonth: qualification.targetMonth || undefined,
      budgetRange: qualification.budgetRange || undefined,
      paxQuad: qualification.paxQuad,
      paxTriple: qualification.paxTriple,
      paxDouble: qualification.paxDouble,
      paxInfant: qualification.paxInfant,
    }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      onStarted({ prospectId: result.prospectId, brandId: brandId! });
    },
    onError: (err: Error & { status?: number; details?: { code?: string; prospectId?: number; picName?: string | null } }) => {
      if (err.status === 409 && err.details?.code === 'already_handled' && err.details.prospectId) {
        setHandled({ prospectId: err.details.prospectId, picName: err.details.picName ?? null });
        return;
      }
      setError(err.message || 'Chat baru gagal dimulai.');
    },
  });

  const submit = () => { setError(''); setHandled(null); start.mutate(); };
  const complete = isQualificationComplete(qualification);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Chat baru"
      description="Buka chat ke nomor dari tim sosmed. Anda langsung menjadi PIC prospek ini; pesan pertama diketik di Inbox."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={start.isPending}>Batal</Button>
          <Button onClick={submit} disabled={!ready || start.isPending}>{start.isPending ? 'Memeriksa...' : 'Mulai chat'}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>}
        {handled && (
          <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p>Nomor ini sudah ditangani <b>{handled.picName ?? 'CS lain'}</b>.</p>
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => onOpenExisting({ prospectId: handled.prospectId, brandId: brandId! })}>
              Buka percakapan
            </Button>
          </div>
        )}

        {brands.length > 1 && (
          <div>
            <span className={fieldLabel}>Brand *</span>
            <Select
              aria-label="Brand"
              value={brandId ? String(brandId) : ''}
              onValueChange={(value) => setBrandId(Number(value))}
              options={brands.map((brand) => ({ value: String(brand.id), label: brand.name }))}
              disabled={start.isPending}
              className="w-full"
            />
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className={fieldLabel}>Nomor WhatsApp *</span>
            <input className={inputClass} inputMode="tel" autoComplete="off" placeholder="08xx atau 628xx" value={phone} onChange={(event) => setPhone(event.target.value)} disabled={start.isPending} />
          </label>
          <label>
            <span className={fieldLabel}>Nama (opsional)</span>
            <input className={inputClass} autoComplete="off" maxLength={100} value={name} onChange={(event) => setName(event.target.value)} disabled={start.isPending} />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className={fieldLabel}>Sumber *</span>
            <Select
              aria-label="Sumber prospek"
              value={source || 'none'}
              onValueChange={(value) => setSource(value === 'none' ? '' : (value as SosmedSource))}
              options={[{ value: 'none', label: 'Pilih sumber...' }, ...SOSMED_SOURCES.map((item) => ({ value: item.value, label: item.label }))]}
              disabled={start.isPending}
              className="w-full"
            />
          </div>
          <label>
            <span className={fieldLabel}>Catatan (opsional)</span>
            <input className={inputClass} autoComplete="off" maxLength={1000} placeholder="Mis. username IG" value={notes} onChange={(event) => setNotes(event.target.value)} disabled={start.isPending} />
          </label>
        </div>

        <div className="rounded-lg border border-zinc-200">
          <button
            type="button"
            onClick={() => setShowQualification((value) => !value)}
            aria-expanded={showQualification}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-semibold text-zinc-700"
          >
            <span>Kualifikasi (opsional){complete ? ' — lengkap, status Terkualifikasi' : ''}</span>
            <ChevronDown size={14} className={showQualification ? 'rotate-180 transition-transform' : 'transition-transform'} aria-hidden="true" />
          </button>
          {showQualification && (
            <div className="border-t border-zinc-200 p-3">
              <QualificationFields
                layout="page"
                value={qualification}
                onChange={(patch) => setQualification((prev) => ({ ...prev, ...patch }))}
                disabled={start.isPending}
              />
            </div>
          )}
        </div>

        <p className="flex items-start gap-1.5 text-xs text-amber-800">
          <TriangleAlert size={13} className="mt-px shrink-0" aria-hidden="true" />
          <span>Nomor ini belum pernah chat dengan brand. Saat mengirim pesan pertama, tulis dengan sopan dan bukan salinan massal; pesan dingin yang sering dilaporkan bisa membuat nomor WhatsApp diblokir.</span>
        </p>
      </div>
    </Modal>
  );
}

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { Select } from '../../components/ui/select';

type PicProspect = { id: number; name: string; brandId: number; userId?: number | null };
type Candidate = { id: number; name: string; openProspects: number };

const RELEASE = 'release';

/** Klien-side cermin aturan server: CS hanya mengubah prospek miliknya atau yang belum ber-PIC. */
/**
 * Siapa yang boleh mengubah prospek — sama dengan API (`pic.ts: canActOnProspect`): Admin/Superadmin selalu,
 * CS bila PIC atau prospek belum ber-PIC. Finance hanya menangani bukti & verifikasi pembayaran (bukan ubah prospek).
 */
export function canEditProspect(user: { id: number; role: string } | null | undefined, prospect: { userId?: number | null }) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'superadmin') return true;
  if (user.role !== 'cs') return false;
  return !prospect.userId || prospect.userId === user.id;
}

/** Keterangan hanya-baca untuk pengguna yang tidak boleh mengubah prospek. */
export function readOnlyNote(user: { role: string } | null | undefined, prospect: { user?: { name?: string } | null }) {
  return user?.role === 'finance'
    ? 'Finance hanya menangani bukti transfer dan verifikasi pembayaran.'
    : `Ditangani ${prospect.user?.name ?? 'CS lain'}; hanya PIC atau Admin yang dapat mengubah.`;
}

export function isLockedForCs(user: { id: number; role: string } | null | undefined, prospect: { userId?: number | null }) {
  return user?.role === 'cs' && Boolean(prospect.userId) && prospect.userId !== user.id;
}

/**
 * - `assign`: Admin/Superadmin menugaskan atau melepas PIC.
 * - `handover`: PIC menyerahkan prospeknya ke CS lain (atau ke antrean) dengan alasan yang tercatat di riwayat.
 * Daftar CS menampilkan jumlah prospek terbuka agar beban kerja terlihat saat memilih.
 */
export function PicDialog({ mode, prospect, onDone, onClose }: {
  mode: 'assign' | 'handover';
  prospect: PicProspect;
  onDone(message: string): void;
  onClose(): void;
}) {
  const [target, setTarget] = useState<string>(mode === 'assign' && prospect.userId ? String(prospect.userId) : '');
  const [reason, setReason] = useState('');
  const candidatesQuery = useQuery({
    queryKey: ['pic-candidates', prospect.id],
    queryFn: () => api.get<Candidate[]>(`/prospects/${prospect.id}/pic-candidates?brandId=${prospect.brandId}`),
  });
  const candidates = (candidatesQuery.data ?? []).filter((c) => mode === 'assign' || c.id !== prospect.userId);
  const nameOf = (id: number | null) => candidates.find((c) => c.id === id)?.name;

  const save = useMutation({
    mutationFn: (userId: number | null) =>
      mode === 'assign'
        ? api.post(`/prospects/${prospect.id}/assign`, { userId, brandId: prospect.brandId })
        : api.post(`/prospects/${prospect.id}/handover`, { targetUserId: userId, reason: reason.trim(), brandId: prospect.brandId }),
    onSuccess: (_data, userId) => {
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['prospect', prospect.id] });
      onDone(userId
        ? `PIC ${prospect.name} sekarang ${nameOf(userId) ?? 'CS terpilih'}.`
        : `PIC ${prospect.name} dilepas ke antrean "Belum ada PIC".`);
    },
  });

  const targetId = target && target !== RELEASE ? Number(target) : null;
  const needsReason = mode === 'handover' && reason.trim().length < 3;
  const unchanged = mode === 'assign' && targetId === (prospect.userId ?? null) && target !== RELEASE;
  const title = mode === 'assign' ? 'Tugaskan PIC' : 'Serahkan PIC';
  const options = [
    ...candidates.map((c) => ({ value: String(c.id), label: `${c.name} · ${c.openProspects} prospek terbuka` })),
    ...(mode === 'handover' ? [{ value: RELEASE, label: 'Lepas ke antrean (tanpa PIC)' }] : []),
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={mode === 'assign'
        ? <>Pilih CS aktif yang menangani <strong>{prospect.name}</strong>.</>
        : <>Serahkan <strong>{prospect.name}</strong> ke CS lain. Alasan tercatat di riwayat prospek.</>}
      footer={
        <>
          {mode === 'assign' && prospect.userId ? (
            <Button type="button" variant="ghost" className="mr-auto" onClick={() => save.mutate(null)} disabled={save.isPending}>Lepas PIC</Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={onClose}>Batal</Button>
          <Button
            type="button"
            onClick={() => save.mutate(targetId)}
            disabled={!target || unchanged || needsReason || save.isPending}
          >
            {save.isPending ? 'Menyimpan…' : mode === 'assign' ? 'Simpan' : 'Serahkan'}
          </Button>
        </>
      }
    >
        <div className="space-y-3">
          {candidatesQuery.isLoading ? (
            <p className="text-xs text-zinc-600">Memuat daftar CS…</p>
          ) : candidatesQuery.isError ? (
            <p className="text-xs text-rose-700" role="alert">{(candidatesQuery.error as Error).message}</p>
          ) : options.length === 0 ? (
            <p className="text-xs text-zinc-600">Belum ada CS aktif lain untuk brand ini. Tambahkan di menu Staf.</p>
          ) : (
            <Select
              value={target || undefined}
              onValueChange={setTarget}
              aria-label={mode === 'assign' ? 'CS penanggung jawab' : 'CS pengganti'}
              placeholder="Pilih CS"
              className="w-full"
              options={options}
            />
          )}
          {mode === 'handover' && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-zinc-600">Alasan</span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Mis. cuti, jamaah minta CS lain, beban penuh"
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
              />
            </label>
          )}
          {save.error && <p className="text-xs text-rose-700" role="alert">{save.error.message}</p>}
        </div>
    </Modal>
  );
}

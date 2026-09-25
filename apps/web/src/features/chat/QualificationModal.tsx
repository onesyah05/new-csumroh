import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { isQualificationComplete, type MatchablePackage } from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { QualificationFields, type QualificationValue } from '../prospects/QualificationFields';

interface QualificationModalProps {
  open: boolean;
  onClose: () => void;
  prospect: any;
  brandId?: number;
  packages?: MatchablePackage[];
  onShowToast: (msg: string) => void;
}

/** Kualifikasi dari Pipeline (mis. saat kartu dipindah ke Terkualifikasi). Isian sama dengan Inbox dan detail. */
export function QualificationModal({ open, onClose, prospect, brandId, packages, onShowToast }: QualificationModalProps) {
  const [value, setValue] = useState<QualificationValue>(() => ({
    targetMonth: prospect?.targetMonth ?? '',
    budgetRange: prospect?.budgetRange ?? '',
    passportStatus: prospect?.passportStatus ?? '',
    paxQuad: Number(prospect?.paxQuad ?? 0),
    paxTriple: Number(prospect?.paxTriple ?? 0),
    paxDouble: Number(prospect?.paxDouble ?? 0),
    paxInfant: Number(prospect?.paxInfant ?? 0),
  }));
  const [packageId, setPackageId] = useState<string>(prospect?.packageId ? String(prospect.packageId) : '');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => api.patch<any>(`/prospects/${prospect.id}/profile`, {
      ...value,
      ...(packageId && packageId !== String(prospect?.packageId ?? '') ? { packageId: Number(packageId) } : {}),
      brandId,
    }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['prospect', prospect.id] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      onShowToast(res?.status === 'qualified' && prospect?.status !== 'qualified'
        ? 'Kualifikasi lengkap. Prospek naik ke Terkualifikasi.'
        : 'Kualifikasi disimpan.');
      onClose();
    },
    onError: (err: Error) => setError(err.message || 'Kualifikasi gagal disimpan.'),
  });

  const selected = packages?.find((pkg) => String(pkg.id) === packageId);
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Kualifikasi prospek"
      description={<>Untuk <b className="text-zinc-800">{prospect?.name}</b>. Boleh diisi bertahap; naik ke Terkualifikasi setelah bulan, jamaah, budget, dan paspor lengkap.</>}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>Batal</Button>
          <Button onClick={() => { setError(''); save.mutate(); }} disabled={save.isPending}>
            {save.isPending ? 'Menyimpan...' : 'Simpan kualifikasi'}
          </Button>
        </>
      }
    >
      {error && <p role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>}
      <QualificationFields
        layout="page"
        value={value}
        onChange={(patch) => setValue((prev) => ({ ...prev, ...patch }))}
        disabled={save.isPending}
        packages={packages}
        selectedPackageId={packageId}
        onSelectPackage={setPackageId}
        departure={selected?.departureDate ? new Date(selected.departureDate) : null}
      />
      {!isQualificationComplete(value) && (
        <p className="mt-3 text-xs text-zinc-600">Boleh disimpan walau belum lengkap; status tetap di tahap sekarang.</p>
      )}
    </Modal>
  );
}

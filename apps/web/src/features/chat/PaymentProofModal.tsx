import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FileText, Send } from 'lucide-react';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { PrivateProofPreview } from './PrivateProof';
import { Modal } from '../../components/ui/modal';

interface PaymentProofModalProps {
  open: boolean;
  onClose: () => void;
  prospect: any;
  brandId?: number;
  onShowToast: (msg: string) => void;
}

export function PaymentProofModal({
  open,
  onClose,
  prospect,
  brandId,
  onShowToast,
}: PaymentProofModalProps) {
  // Berkas baru (data URL) diunggah ke storage privat; bukti lama hanya ditampilkan.
  const [fileData, setFileData] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string>('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setFileError(null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setFileError('Ukuran berkas melebihi 5MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setFileData(reader.result);
        setFileName(file.name);
      }
    };
    reader.readAsDataURL(file);
  };

  const isPdf = fileData.startsWith('data:application/pdf');

  const proofMutation = useMutation({
    mutationFn: () =>
      api.post(`/prospects/${prospect.id}/payment-proof-upload`, {
        image: fileData,
        notes: notes.trim(),
        brandId: brandId ?? prospect.brandId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['prospect', prospect.id] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['verification-queue'] });
      onShowToast('Bukti terkirim ke Finance');
      onClose();
    },
    onError: (err: any) => {
      onShowToast(err?.message || 'Bukti gagal diunggah.');
    },
  });

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Unggah bukti transfer"
      description="Deal setelah Finance memverifikasi."
      footer={
        <Button size="sm" icon={<Send size={14} />} loading={proofMutation.isPending} onClick={() => proofMutation.mutate()} disabled={proofMutation.isPending || !fileData}>
          Kirim ke Finance
        </Button>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-zinc-600">Foto atau PDF (maks. 5 MB)</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={handleFileChange}
            className="w-full text-xs text-zinc-600 file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-zinc-800"
          />
          {fileError && <span role="alert" className="mt-1 block text-xs text-rose-700">{fileError}</span>}
        </label>
        {(fileData || prospect?.paymentProofUrl) && (
          <div>
            <span className="mb-1 block text-xs font-semibold text-zinc-600">{fileData ? 'Pratinjau' : 'Bukti sebelumnya'}</span>
            <div className="flex min-h-20 items-center justify-center rounded-lg bg-zinc-50 p-2">
              {fileData ? (
                isPdf ? (
                  <span className="flex items-center gap-2 text-xs text-zinc-700"><FileText size={16} aria-hidden="true" />{fileName}</span>
                ) : (
                  <img src={fileData} alt="Bukti transfer" className="max-h-44 rounded-md object-contain" />
                )
              ) : (
                <PrivateProofPreview url={prospect.paymentProofUrl} />
              )}
            </div>
          </div>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-zinc-600">Catatan untuk Finance (opsional)</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Mis. transfer BSI a/n pengirim" className="field h-auto resize-none py-2" />
        </label>
      </div>
    </Modal>
  );
}

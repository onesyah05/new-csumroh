import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FileText, Send, UploadCloud, X } from 'lucide-react';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { PrivateProofPreview } from './PrivateProof';
import { ModalFrame } from '../../components/ui/modal';

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
      onShowToast('Bukti transfer berhasil diunggah! Notifikasi terkirim ke tim Finance.');
      onClose();
    },
    onError: (err: any) => {
      onShowToast(err?.message || 'Gagal mengunggah bukti transfer.');
    },
  });

  if (!open) return null;

  return (
    <ModalFrame open={open} onClose={onClose} title="Unggah bukti transfer">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 bg-emerald-50/80">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-600 text-white">
              <UploadCloud size={18} />
            </span>
            <div>
              <h3 className="font-bold text-sm text-zinc-900">Unggah Bukti Transfer</h3>
              <p className="text-xs text-zinc-500">Kirim ke Finance untuk verifikasi mutasi & deal</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="thin-scrollbar flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          <div className="space-y-2">
            <label className="font-bold uppercase tracking-wider text-xs text-zinc-500">
              Pilih Foto / PDF Bukti Transfer (maks. 5MB)
            </label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={handleFileChange}
              className="w-full text-xs text-zinc-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer"
            />
            {fileError && <p className="text-xs text-rose-600">{fileError}</p>}
          </div>

          {/* Preview: berkas baru, atau bukti yang sudah tersimpan (dibaca privat) */}
          {(fileData || prospect?.paymentProofUrl) && (
            <div className="space-y-1">
              <span className="font-bold uppercase tracking-wider text-xs text-zinc-500">
                {fileData ? 'Pratinjau Bukti Baru:' : 'Bukti Tersimpan Saat Ini:'}
              </span>
              <div className="rounded-xl border border-zinc-200 overflow-hidden bg-zinc-50 min-h-20 flex items-center justify-center p-2">
                {fileData ? (
                  isPdf ? (
                    <span className="flex items-center gap-2 text-xs text-zinc-700">
                      <FileText size={16} className="text-emerald-700" /> {fileName}
                    </span>
                  ) : (
                    <img src={fileData} alt="Bukti Transfer" className="max-h-44 object-contain rounded-lg shadow-xs" />
                  )
                ) : (
                  <PrivateProofPreview url={prospect.paymentProofUrl} />
                )}
              </div>
            </div>
          )}

          {/* Notes for Finance */}
          <div className="space-y-1.5">
            <label className="font-bold uppercase tracking-wider text-xs text-zinc-500">
              Catatan untuk Tim Finance (Opsional)
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contoh: Transfer via BSI an Ahmad Sudirman, nominal Rp 10.000.000 untuk 2 pax..."
              className="w-full rounded-xl border border-zinc-200 p-2.5 text-xs leading-relaxed focus:border-emerald-500 focus:outline-none resize-none"
            />
          </div>

          <div className="rounded-xl bg-amber-50/70 border border-amber-200 p-2.5 text-xs text-amber-900 leading-relaxed">
            🛡️ <strong>Info Keamanan Anti-Fraud:</strong> Setelah bukti diunggah, status prospek tetap di Tunggu Verifikasi sampai diverifikasi langsung oleh tim <strong>Finance</strong>. CS tidak dapat mengubah ke Deal secara sepihak.
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3.5 bg-zinc-50">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={proofMutation.isPending}>
            Batal
          </Button>
          <Button
            size="sm"
            onClick={() => proofMutation.mutate()}
            disabled={proofMutation.isPending || !fileData}
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
          >
            <Send size={14} />
            {proofMutation.isPending ? 'Mengunggah...' : 'Kirim ke Finance'}
          </Button>
        </div>
      </div>
    </ModalFrame>
  );
}

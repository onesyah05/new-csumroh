import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Copy, FileCheck, Sparkles, X } from 'lucide-react';
import { packageBookingValue } from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { deliverDraftText } from './draftText';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { ModalFrame } from '../../components/ui/modal';

interface OfficialOfferModalProps {
  open: boolean;
  onClose: () => void;
  prospect: any;
  packages: any[];
  brandId?: number;
  onInsertText?: (text: string) => void;
  onShowToast: (msg: string) => void;
}

const rupiah = (val: unknown) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(
    Number(val ?? 0)
  );

export function OfficialOfferModal({
  open,
  onClose,
  prospect,
  packages,
  brandId,
  onInsertText,
  onShowToast,
}: OfficialOfferModalProps) {
  const [selectedPkgId, setSelectedPkgId] = useState<string>(
    prospect?.packageId ? String(prospect.packageId) : packages[0]?.id ? String(packages[0].id) : ''
  );
  const [customNote, setCustomNote] = useState('');

  const selectedPackage = useMemo(() => {
    return packages.find((p) => String(p.id) === selectedPkgId) || packages[0];
  }, [packages, selectedPkgId]);

  const totalPax =
    (Number(prospect?.paxQuad ?? 0)) +
    (Number(prospect?.paxTriple ?? 0)) +
    (Number(prospect?.paxDouble ?? 0)) +
    (Number(prospect?.paxInfant ?? 0)) || 1;

  // Sama dengan perhitungan backend (harga katalog × pax); backend tetap menjadi sumber kebenaran.
  const dealValue = useMemo(
    () => (selectedPackage && prospect ? packageBookingValue(selectedPackage, prospect) : 0),
    [selectedPackage, prospect],
  );

  const generatedScript = useMemo(() => {
    if (!selectedPackage) return '';
    return [
      `Bismillah, kami rekomendasikan Penawaran Paket Umroh Terbaik untuk Bapak/Ibu *${prospect?.name || 'Jamaah'}*:`,
      '',
      `🕋 *${selectedPackage.name}*`,
      selectedPackage.airline ? `✈️ Maskapai: ${selectedPackage.airline}` : null,
      selectedPackage.duration ? `⏳ Durasi: ${selectedPackage.duration}` : null,
      selectedPackage.departureInfo ? `🗓️ Rencana: ${selectedPackage.departureInfo}` : null,
      selectedPackage.hotelMakkah ? `🏨 Makkah: ${selectedPackage.hotelMakkah}` : null,
      selectedPackage.hotelMadinah ? `🏨 Madinah: ${selectedPackage.hotelMadinah}` : null,
      '',
      `💰 *Estimasi Total Investasi Ibadah*:`,
      `• Jumlah Jamaah: ${totalPax} Pax`,
      prospect?.roomPreference ? `• Tipe Kamar: ${prospect.roomPreference}` : null,
      dealValue > 0 ? `👉 *Total Estimasi Biaya*: *${rupiah(dealValue)}*` : `👉 *Total Estimasi Biaya*: Menunggu penetapan harga resmi di katalog`,
      '',
      `✨ *Fasilitas*:`,
      selectedPackage.facilitiesIncluded
        ? `✅ ${selectedPackage.facilitiesIncluded}`
        : `✅ Sesuai rincian fasilitas resmi brosur paket`,
      selectedPackage.highlights ? `📌 ${selectedPackage.highlights}` : null,
      customNote ? `\n📌 *Catatan Khusus*: ${customNote}` : null,
      '',
      `Apakah jadwal dan fasilitas penawaran ini sudah sesuai dengan yang diharapkan Bapak/Ibu? Jika cocok, kami dapat amankan kuota seat-nya sekarang. 🙏`,
    ]
      .filter(Boolean)
      .join('\n');
  }, [selectedPackage, prospect?.name, prospect?.roomPreference, totalPax, dealValue, customNote]);

  const sendOfferMutation = useMutation({
    mutationFn: (sendViaWhatsApp: boolean) =>
      api.post(`/prospects/${prospect.id}/offer`, {
        packageId: Number(selectedPkgId),
        customNotes: customNote,
        brandId: brandId ?? prospect.brandId,
        sendViaWhatsApp,
        // Naskah dikirim backend melalui gateway WhatsApp; status "terkirim" hanya bila berhasil.
        ...(sendViaWhatsApp ? { messageText: generatedScript } : {}),
      }),
    onSuccess: async (_, sendViaWhatsApp) => {
      void queryClient.invalidateQueries({ queryKey: ['prospect', prospect.id] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (sendViaWhatsApp) {
        onShowToast('Penawaran resmi terkirim ke WhatsApp jamaah; status menjadi Ditawarkan (offer).');
      } else {
        const where = await deliverDraftText(generatedScript, onInsertText);
        onShowToast(`Draft penawaran ${where}; status prospek tidak berubah.`);
      }
      onClose();
    },
    onError: (err: any) => {
      onShowToast(err?.message || 'Gagal memproses penawaran resmi.');
    },
  });

  if (!open) return null;

  return (
    <ModalFrame open={open} onClose={onClose} title="Penawaran resmi">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 bg-zinc-50">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-indigo-100 text-indigo-700">
              <FileCheck size={18} />
            </span>
            <div>
              <h3 className="font-bold text-sm text-zinc-900">Buat Penawaran Resmi</h3>
              <p className="text-[11px] text-zinc-500">Mempromosikan status prospek ke Ditawarkan (offer)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="thin-scrollbar flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {/* Package Selection */}
          <div className="space-y-1.5">
            <label className="font-bold uppercase tracking-wider text-[10px] text-zinc-500">
              Pilih Paket Umroh
            </label>
            <Select
              value={selectedPkgId}
              onValueChange={setSelectedPkgId}
              options={packages.map((pkg) => ({
                value: String(pkg.id),
                label: `${pkg.name} (${pkg.departureInfo || 'Tgl belum ditentukan'})`,
              }))}
              className="w-full"
            />
          </div>

          {/* Deal Value Breakdown */}
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 flex items-center justify-between">
            <div>
              <p className="text-[11px] text-zinc-500">Estimasi Total Deal ({totalPax} Pax):</p>
              <p className="text-base font-extrabold text-indigo-700">{rupiah(dealValue)}</p>
            </div>
            <span className="text-[10px] font-semibold bg-indigo-50 text-indigo-800 border border-indigo-200 rounded-full px-2.5 py-1">
              Trigger CAPI: AddToCart
            </span>
          </div>

          {/* Custom Notes */}
          <div className="space-y-1">
            <label className="font-bold uppercase tracking-wider text-[10px] text-zinc-500">
              Catatan Khusus / Promo Tambahan (Opsional)
            </label>
            <input
              type="text"
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
              placeholder="Contoh: Diskon khusus booking hari ini Rp 1 Juta..."
              className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* WhatsApp Script Preview */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-bold uppercase tracking-wider text-[10px] text-zinc-500 flex items-center gap-1">
                <Sparkles size={12} className="text-amber-500" />
                Pratinjau Pesan Penawaran WhatsApp
              </label>
              <span className="text-[10px] text-zinc-400">Naskah yang dikirim ke WhatsApp jamaah</span>
            </div>
            <textarea
              readOnly
              value={generatedScript}
              rows={8}
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 font-mono text-[11px] text-zinc-700 leading-relaxed resize-none focus:outline-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-200 px-5 py-3.5 bg-zinc-50">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={sendOfferMutation.isPending}>
            Batal
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => sendOfferMutation.mutate(false)}
              disabled={sendOfferMutation.isPending || !selectedPkgId}
              className="gap-1 text-zinc-700"
              title="Simpan sebagai draft (sisipkan ke chat / salin) tanpa mengirim dan tanpa mengubah status"
            >
              <Copy size={13} />
              <span>Sisipkan Draft Saja</span>
            </Button>
            <Button
              size="sm"
              onClick={() => sendOfferMutation.mutate(true)}
              disabled={sendOfferMutation.isPending || !selectedPkgId || dealValue <= 0}
              className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
            >
              <FileCheck size={14} />
              {sendOfferMutation.isPending ? 'Mengirim...' : 'Kirim via WhatsApp'}
            </Button>
          </div>
        </div>
      </div>
    </ModalFrame>
  );
}

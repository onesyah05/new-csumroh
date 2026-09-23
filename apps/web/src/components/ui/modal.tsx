import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

/**
 * Bingkai modal standar berbasis Radix Dialog: role="dialog" + aria-modal, fokus terkunci di
 * dalam modal, Escape menutup, dan fokus kembali ke tombol pemicu. Isi (kartu) tetap ditulis
 * oleh pemanggil. Klik di luar kartu tidak menutup modal agar isian form tidak hilang.
 */
export function ModalFrame({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Nama dialog untuk pembaca layar. */
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs animate-fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          onPointerDownOutside={(event) => event.preventDefault()}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none"
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

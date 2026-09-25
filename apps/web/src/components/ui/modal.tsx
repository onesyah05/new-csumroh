import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Button } from './button';

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

const SIZES = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl' } as const;

/**
 * Modal standar aplikasi: judul (juga nama dialog untuk pembaca layar), deskripsi opsional, tombol tutup,
 * isi yang bisa di-scroll, dan footer aksi. Pakai ini untuk semua dialog baru; `ModalFrame` hanya untuk
 * tata letak yang benar-benar khusus.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  size?: keyof typeof SIZES;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs animate-fade-in" />
        {/* Pemusatan lewat grid, bukan translate: animasi fade-up memakai transform dan akan menimpanya. */}
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
        <Dialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          onPointerDownOutside={(event) => event.preventDefault()}
          className={cn(
            'pointer-events-auto flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lift outline-none animate-fade-up',
            SIZES[size],
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-bold text-zinc-950">{title}</Dialog.Title>
              {description && <Dialog.Description className="mt-1 text-xs leading-relaxed text-zinc-600">{description}</Dialog.Description>}
            </div>
            <Dialog.Close className="-mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900" aria-label="Tutup">
              <X size={18} />
            </Dialog.Close>
          </div>
          {children !== undefined && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">{children}</div>}
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-100 bg-zinc-50/60 px-5 py-3 sm:px-6">{footer}</div>}
        </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Konfirmasi tindakan (hapus, putuskan, dsb.). Menggantikan `window.confirm` dan dialog konfirmasi
 * yang sebelumnya ditulis ulang di tiap halaman.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Batal',
  tone = 'danger',
  pending = false,
  confirmDisabled = false,
  error,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  pending?: boolean;
  /** Tindakan tidak mungkin dilakukan (mis. brand masih punya data); isi dialog menjelaskan alasannya. */
  confirmDisabled?: boolean;
  error?: string | null;
  children?: ReactNode;
}) {
  const body = children || error ? (
    <>
      {children}
      {error && <p role="alert" className={cn('text-xs text-rose-700', children ? 'mt-3' : '')}>{error}</p>}
    </>
  ) : undefined;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>{cancelLabel}</Button>
          <Button
            type="button"
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={pending}
            disabled={pending || confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body}
    </Modal>
  );
}

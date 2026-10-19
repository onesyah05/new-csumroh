import { memo, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type RefObject, type SetStateAction } from 'react';
import { editMenuState, isEditAuthor, isMediaFileNameText, type EditableMessage } from '@csumroh/shared-types';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  AlertCircle, Ban, Check, CheckCheck, ChevronDown, Clock, Copy, CornerUpLeft, Download, Eye, FileText, ImageIcon,
  Mic, Pencil, Phone, PhoneMissed, ShieldCheck, Smile, Star, Sticker, Trash2, Video,
} from 'lucide-react';
import { resolveMediaUrl } from '../../lib/api';
import { cn } from '../../lib/cn';
import { linkifyText } from '../../lib/linkify';
import { AdReplyCard } from './AdReplyCard';
import { SWIPE_REPLY_THRESHOLD, useSwipeToReply } from './swipeReply';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

export function formatBubbleTime(timestampSeconds?: number): string {
  if (!timestampSeconds) return '';
  const date = new Date(timestampSeconds * 1000);
  return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
}

/** Elemen non-tombol yang bisa diklik juga harus bisa diaktifkan dengan Enter/Spasi (WCAG 2.1.1). */
export function activateWithKeyboard(event: ReactKeyboardEvent<HTMLElement>, action: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  action();
}

/** Panggilan yang tidak tersambung (tak terjawab/ditolak) ditandai merah. */
export function isMissedCall(text?: string | null) {
  return /tak terjawab|ditolak/.test(text ?? '');
}

export function CallIcon({ text, size }: { text?: string | null; size: number }) {
  if (isMissedCall(text)) return <PhoneMissed size={size} aria-hidden="true" />;
  return /video/i.test(text ?? '') ? <Video size={size} aria-hidden="true" /> : <Phone size={size} aria-hidden="true" />;
}

export type ReplyTarget = { id: number; messageId: string; senderName: string; text: string };

export type MessageBubbleProps = {
  item: any;
  isNewDate: boolean;
  dateLabel: string;
  isPickerOpen: boolean;
  isRevealedByAdmin: boolean;
  isAdmin: boolean;
  showDeletedMessages: boolean;
  canSend: boolean;
  canReply: boolean;
  /** HP: geser bubble ke kanan untuk membalas (hanya bila boleh membalas). */
  swipeToReply?: boolean;
  selected: any;
  user: any;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  setActiveReactionMessageId: Dispatch<SetStateAction<number | null>>;
  setRevealedDeletedIds: Dispatch<SetStateAction<Set<number>>>;
  setReplyingTo: Dispatch<SetStateAction<ReplyTarget | null>>;
  setDeleteConfirmId: Dispatch<SetStateAction<number | null>>;
  /** Mulai mengedit pesan teks milik kita (teks masuk ke kotak ketik). */
  startEdit: (item: EditableMessage) => void;
  setPreviewFlyer: (url: string | null) => void;
  reactMutate: (vars: { messageId: number; emoji: string }) => void;
  starMutate: (messageId: number) => void;
  proofMutate: (messageId: number) => void;
  proofPending: boolean;
  scrollToMessage: (messageId?: string | null) => void;
  showToast: (message: string) => void;
};

/**
 * Satu gelembung chat. Dibungkus memo: mengetik di kolom pesan tidak lagi merender ulang ratusan gelembung,
 * dan pesan masuk hanya merender gelembung barunya.
 */
export const MessageBubble = memo(function MessageBubble({
  item, isNewDate, dateLabel, isPickerOpen, isRevealedByAdmin, isAdmin, showDeletedMessages, canSend, canReply, swipeToReply, selected, user,
  composerRef, setActiveReactionMessageId, setRevealedDeletedIds, setReplyingTo, setDeleteConfirmId, startEdit, setPreviewFlyer,
  reactMutate, starMutate, proofMutate, proofPending, scrollToMessage, showToast,
}: MessageBubbleProps) {
  const isMessageDeleted = Boolean(item.isDeleted);
  const startReply = () => {
    if (!canReply) return;
    setReplyingTo({
      id: item.id,
      messageId: item.messageId,
      senderName: item.isFromMe ? 'Anda' : (item.senderName || selected.name),
      text: item.messageText || (item.messageType === 'imageMessage' ? 'Foto' : 'Pesan'),
    });
    composerRef.current?.focus();
  };
  const swipe = useSwipeToReply({ enabled: Boolean(swipeToReply) && !isMessageDeleted, onReply: startReply });
  return (
              <div id={`msg-${item.messageId}`} className="transition-colors duration-500 rounded-lg">
                {isNewDate && (
                  <div className="my-3 flex items-center justify-center">
                    <span className="rounded-lg bg-white/95 px-3 py-1 text-xs font-medium text-[#54656f] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] uppercase">
                      {dateLabel}
                    </span>
                  </div>
                )}
  
                {(() => {
  
                  const reactionTrigger = (
                    <div className="relative shrink-0 flex items-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveReactionMessageId((prev) => (prev === item.id ? null : item.id));
                        }}
                        className={cn(
                          'h-6 w-6 sm:h-7 sm:w-7 rounded-full bg-white text-[#54656f] hover:text-[#111b21] shadow-[0_1px_2px_rgba(0,0,0,0.15)] border border-black/10 flex items-center justify-center transition-all hover:scale-110 active:scale-95 cursor-pointer',
                          isPickerOpen
                            ? 'opacity-100 ring-2 ring-[#00a884]/30'
                            : 'opacity-0 group-hover:opacity-100 transition-opacity duration-150'
                        )}
                        title="Beri reaksi"
                        aria-label="Beri reaksi"
                      >
                        <Smile size={15} />
                      </button>
  
                      {/* Quick Reaction Floating Popover */}
                      {isPickerOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-30 cursor-default"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveReactionMessageId(null);
                            }}
                          />
                          <div
                            className={cn(
                              'absolute bottom-full mb-2 z-40 flex items-center gap-1 rounded-full bg-white px-2 py-1.5 shadow-[0_2px_12px_rgba(0,0,0,0.18)] border border-black/10 animate-in fade-in zoom-in-95 duration-150 select-none',
                              item.isFromMe ? 'right-0 sm:right-auto sm:left-0' : 'left-0'
                            )}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {QUICK_REACTIONS.map((emoji) => {
                              const isSelected = item.reaction === emoji;
                              // Jika emoji ini sudah dipilih oleh orang lain (bukan saya), disable toggle
                              const isAdmin = user?.role === 'superadmin' || user?.role === 'admin';
                              const isProspectReaction = isSelected && item.reactionUserId === null && !item.isFromMe;
                              const isOtherCSReaction = isSelected && item.reactionUserId !== null && item.reactionUserId !== user?.id && !isAdmin;
                              const canToggleThisEmoji = !isProspectReaction && !isOtherCSReaction;
                              return (
                                <button
                                  key={emoji}
                                  type="button"
                                  disabled={!canToggleThisEmoji}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (canToggleThisEmoji) reactMutate({ messageId: item.id, emoji });
                                  }}
                                  className={cn(
                                    'h-8 w-8 rounded-full flex items-center justify-center text-lg hover:scale-125 active:scale-90 transition-all hover:bg-black/5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100',
                                    isSelected && 'bg-emerald-100 ring-1 ring-emerald-500 scale-110'
                                  )}
                                  title={
                                    isProspectReaction ? 'Reaksi jamaah (tidak bisa dihapus)' :
                                    isOtherCSReaction ? 'Reaksi CS lain (tidak bisa dihapus)' :
                                    isSelected ? `Hapus reaksi ${emoji}` : `Beri reaksi ${emoji}`
                                  }
                                >
                                  <span className="leading-none">{emoji}</span>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  );
  
                  return (
                    <div
                      className={cn(
                        'group relative flex items-center gap-1.5 my-1',
                        item.isFromMe ? 'justify-end' : 'justify-start',
                        item.reaction ? 'mb-3' : 'mb-1',
                        swipeToReply && !isMessageDeleted && 'touch-pan-y',
                      )}
                      {...swipe.handlers}
                      style={swipe.offset ? { transform: `translateX(${swipe.offset}px)` } : undefined}
                    >
                      {swipe.offset > 0 && (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute left-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-black/10 text-[#54656f]"
                          style={{ transform: `translate(${-swipe.offset}px, -50%) scale(${Math.min(1, swipe.offset / SWIPE_REPLY_THRESHOLD)})`, opacity: Math.min(1, swipe.offset / (SWIPE_REPLY_THRESHOLD * 0.6)) }}
                        >
                          <CornerUpLeft size={16} />
                        </span>
                      )}
                      {item.isFromMe && !isMessageDeleted && canSend && reactionTrigger}
  
                      <div className={cn(
                        'relative max-w-[82%] sm:max-w-[65%] rounded-lg px-3 py-1.5 shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] transition-all',
                        item.isFromMe
                          ? 'rounded-tr-none bg-[#d9fdd3] text-[#111b21]'
                          : 'rounded-tl-none bg-white text-[#111b21]',
                        isMessageDeleted && !isRevealedByAdmin && 'opacity-85 bg-[#f0f2f5] text-[#667781] border border-black/5'
                      )}>
                        {/* WhatsApp Web Context Menu Trigger (ChevronDown) on Bubble Hover */}
                        <div className="absolute top-1 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                          <DropdownMenu.Root>
                            <DropdownMenu.Trigger asChild>
                              <button
                                type="button"
                                className="h-5 w-5 rounded-full bg-white/90 hover:bg-white text-[#54656f] hover:text-[#111b21] shadow-xs flex items-center justify-center transition cursor-pointer border border-black/5"
                                title="Menu pesan"
                                aria-label="Menu pesan"
                              >
                                <ChevronDown size={13} />
                              </button>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content
                                align={item.isFromMe ? 'end' : 'start'}
                                sideOffset={4}
                                className="z-50 min-w-[160px] rounded-xl bg-white p-1 shadow-[0_4px_16px_rgba(0,0,0,0.15)] border border-black/10 text-xs animate-in fade-in zoom-in-95"
                              >
                                <DropdownMenu.Item
                                  disabled={!canReply}
                                  onClick={startReply}
                                  className={cn(
                                    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[#111b21] outline-none',
                                    canReply ? 'hover:bg-[#f0f2f5] cursor-pointer' : 'opacity-40 cursor-not-allowed'
                                  )}
                                  title={canReply ? 'Balas pesan' : `Hanya Admin dan PIC (${selected.user?.name || 'CS lain'}) yang dapat membalas`}
                                >
                                  <CornerUpLeft size={14} className="text-[#54656f]" />
                                  <span>Balas {!canReply && '(Hanya Admin/PIC)'}</span>
                                </DropdownMenu.Item>
  
                                {item.messageText && !isMessageDeleted && (
                                  <DropdownMenu.Item
                                    onClick={() => {
                                      void navigator.clipboard.writeText(item.messageText);
                                      showToast('Teks pesan disalin');
                                    }}
                                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[#111b21] hover:bg-[#f0f2f5] outline-none cursor-pointer"
                                  >
                                    <Copy size={14} className="text-[#54656f]" />
                                    <span>Salin</span>
                                  </DropdownMenu.Item>
                                )}
  
                                {/* Edit: aturan, alasan, dan akses dari shared-types (sama dengan server). */}
                                {item.isFromMe && !isMessageDeleted && (() => {
                                  const edit = editMenuState(item, {
                                    canEdit: isEditAuthor({ role: user?.role ?? '', userId: user?.id, picUserId: selected?.user?.id }),
                                    picName: selected?.user?.name,
                                  });
                                  if (!edit.visible) return null;
                                  return (
                                    <DropdownMenu.Item
                                      disabled={!edit.enabled}
                                      onClick={() => { if (edit.enabled) startEdit(item); }}
                                      title={edit.reason ?? 'Edit pesan'}
                                      className={cn(
                                        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[#111b21] outline-none',
                                        edit.enabled ? 'hover:bg-[#f0f2f5] cursor-pointer' : 'opacity-40 cursor-not-allowed',
                                      )}
                                    >
                                      <Pencil size={14} className="text-[#54656f]" />
                                      <span>Edit{edit.label ? ` (${edit.label})` : ''}</span>
                                    </DropdownMenu.Item>
                                  );
                                })()}

                                {!isMessageDeleted && canSend && (
                                  <DropdownMenu.Item
                                    onClick={() => {
                                      setActiveReactionMessageId(item.id);
                                    }}
                                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[#111b21] hover:bg-[#f0f2f5] outline-none cursor-pointer"
                                  >
                                    <Smile size={14} className="text-[#54656f]" />
                                    <span>Reaksi</span>
                                  </DropdownMenu.Item>
                                )}
  
                                <DropdownMenu.Item
                                  onClick={() => {
                                    starMutate(item.id);
                                  }}
                                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[#111b21] hover:bg-[#f0f2f5] outline-none cursor-pointer"
                                >
                                  <Star size={14} className={cn(item.isStarred ? 'fill-amber-400 text-amber-500' : 'text-[#54656f]')} />
                                  <span>{item.isStarred ? 'Hapus bintang' : 'Beri bintang'}</span>
                                </DropdownMenu.Item>
  
                                {/* Bukti transfer langsung dari chat: server menyalin berkas, tanpa unduh-unggah ulang */}
                                {(canReply || user?.role === 'finance') && !['deal', 'closed_won'].includes(selected?.status || '') && !isMessageDeleted && !item.isFromMe && item.mediaUrl && (item.messageType === 'imageMessage' || item.messageType === 'documentMessage') && (
                                  selected?.paymentProofMessageId === item.messageId ? (
                                    <DropdownMenu.Item
                                      disabled
                                      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-emerald-700 outline-none"
                                    >
                                      <ShieldCheck size={14} />
                                      <span>Sudah diajukan ke Finance</span>
                                    </DropdownMenu.Item>
                                  ) : (
                                    <DropdownMenu.Item
                                      onClick={() => proofMutate(item.id)}
                                      disabled={proofPending}
                                      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[#111b21] hover:bg-[#f0f2f5] outline-none cursor-pointer"
                                    >
                                      <ShieldCheck size={14} className="text-emerald-600" />
                                      <span>Kirim ke Finance sebagai bukti transfer</span>
                                    </DropdownMenu.Item>
                                  )
                                )}
  
                                {/* WhatsApp hanya menarik pesan ±2 hari terakhir (batas yang sama di server). */}
                                {!isMessageDeleted && item.isFromMe && canSend && Date.now() / 1000 - item.timestamp <= 2 * 24 * 60 * 60 && (
                                  <>
                                    <DropdownMenu.Separator className="my-1 h-px bg-[#e9edef]" />
                                    <DropdownMenu.Item
                                      onClick={() => setDeleteConfirmId(item.id)}
                                      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-red-600 hover:bg-red-50 outline-none cursor-pointer font-medium"
                                    >
                                      <Trash2 size={14} />
                                      <span>Hapus pesan</span>
                                    </DropdownMenu.Item>
                                  </>
                                )}
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu.Root>
                        </div>
  
                        {isMessageDeleted && !isRevealedByAdmin ? (
                          /* Deleted Message view for regular user / unrevealed */
                          <div className="flex items-center gap-1.5 py-0.5 pr-6 text-[13px] italic text-[#667781] select-none">
                            <Ban size={14} className="shrink-0 text-[#8696a0]" />
                            <span>{item.isFromMe ? 'Anda telah menghapus pesan ini' : 'Pesan ini telah dihapus'}</span>
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => {
                                  setRevealedDeletedIds((prev) => {
                                    const next = new Set(prev);
                                    next.add(item.id);
                                    return next;
                                  });
                                }}
                                className="ml-2 inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-bold text-amber-800 hover:bg-amber-500/25 not-italic cursor-pointer"
                                title="Lihat pesan yang dihapus (Mode Admin)"
                              >
                                <Eye size={11} /> Lihat
                              </button>
                            )}
                          </div>
                        ) : (
                          /* Normal Message or Admin-Revealed Deleted Message */
                          <>
                            {/* Admin Revealed Banner */}
                            {isMessageDeleted && isRevealedByAdmin && (
                              <div className="mb-1.5 flex items-center justify-between gap-2 border-b border-amber-500/30 pb-1 text-xs font-bold text-amber-800">
                                <span className="flex items-center gap-1">
                                  <Eye size={12} className="text-amber-600" />
                                  Pesan Dihapus {item.deletedAt ? `(${new Date(item.deletedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })})` : ''}
                                </span>
                                {!showDeletedMessages && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRevealedDeletedIds((prev) => {
                                        const next = new Set(prev);
                                        next.delete(item.id);
                                        return next;
                                      });
                                    }}
                                    className="text-amber-700 hover:underline cursor-pointer"
                                  >
                                    Tutup
                                  </button>
                                )}
                              </div>
                            )}
  
                            {/* Sender Name (CS name on outgoing, contact name on incoming) - always shown */}
                            {item.isFromMe && item.senderName && (
                              <p className="text-xs font-bold text-[#008069] mb-0.5 leading-tight max-w-[24ch] truncate" title={item.senderName ?? undefined}>
                                {item.senderName}
                              </p>
                            )}
                            {!item.isFromMe && (
                              <p className="text-xs font-bold text-[#53bdeb] mb-0.5 leading-tight max-w-[24ch] truncate" title={item.senderName || selected.name || 'Jamaah'}>
                                {item.senderName || selected.name || 'Jamaah'}
                              </p>
                            )}
  
                            {item.adPreview && <AdReplyCard ad={item.adPreview} isFromMe={item.isFromMe} />}
  
                            {/* Quoted Message Preview inside bubble */}
                            {(item.quotedText || item.quotedMessageId) && (
                              <div
                                role="button"
                                tabIndex={0}
                                aria-label="Lompat ke pesan yang dikutip"
                                onClick={() => scrollToMessage(item.quotedMessageId)}
                                onKeyDown={(event) => activateWithKeyboard(event, () => scrollToMessage(item.quotedMessageId))}
                                className={cn(
                                  'mb-1.5 rounded border-l-4 px-2.5 py-1.5 text-xs cursor-pointer select-none transition-opacity hover:opacity-85',
                                  item.isFromMe
                                    ? 'border-[#00a884] bg-black/[0.04]'
                                    : 'border-[#53bdeb] bg-[#f0f2f5]'
                                )}
                                title="Klik untuk menuju ke pesan yang dikutip"
                              >
                                <div className="font-bold text-xs text-[#008069]">
                                  {item.quotedSender || (item.isFromMe ? 'Anda' : selected.name)}
                                </div>
                                <div className="truncate text-[12px] text-[#54656f]">
                                  {item.quotedText || 'Pesan'}
                                </div>
                              </div>
                            )}
  
                             {/* Image Media Preview */}
                             {item.messageType === 'imageMessage' && (
                               <div className="mb-1.5 overflow-hidden rounded-xl max-w-[280px]">
                                 {item.mediaUrl ? (
                                   <div
                                     role="button"
                                     tabIndex={0}
                                     aria-label="Lihat gambar"
                                     className="relative group cursor-pointer overflow-hidden rounded-xl border border-black/10 bg-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]"
                                     onClick={() => setPreviewFlyer(item.mediaUrl)}
                                     onKeyDown={(event) => activateWithKeyboard(event, () => setPreviewFlyer(item.mediaUrl))}
                                   >
                                     <img
                                       src={resolveMediaUrl(item.mediaUrl)}
                                       alt={item.messageText && item.messageText !== '[Gambar]' ? item.messageText : 'Foto'}
                                       className="w-full max-h-[300px] object-cover rounded-xl transition duration-200 group-hover:scale-[1.01]"
                                       loading="lazy"
                                     />
                                     <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100">
                                       <span className="bg-black/70 text-white text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-md">
                                         <Eye size={13} /> Perbesar
                                       </span>
                                     </div>
                                   </div>
                                 ) : (
                                   <div className="flex items-center gap-2 rounded-lg bg-black/5 p-2 text-xs text-zinc-600">
                                     <ImageIcon size={16} className="shrink-0 text-[#00a884]" />
                                     <span className="font-semibold">Foto / Gambar</span>
                                   </div>
                                 )}
                               </div>
                             )}
  
                             {/* Stiker: gambar kecil tanpa bingkai, seperti di WhatsApp */}
                             {item.messageType === 'stickerMessage' && (
                               <div className="mb-1">
                                 {item.mediaUrl ? (
                                   <img
                                     src={resolveMediaUrl(item.mediaUrl)}
                                     alt="Stiker"
                                     className="h-32 w-32 object-contain"
                                     loading="lazy"
                                   />
                                 ) : (
                                   <div className="flex items-center gap-2 rounded-lg bg-black/5 p-2 text-xs text-zinc-600">
                                     <Sticker size={16} className="shrink-0 text-[#00a884]" />
                                     <span className="font-semibold">Stiker</span>
                                   </div>
                                 )}
                               </div>
                             )}
  
                             {/* Riwayat telepon/video call WhatsApp (tidak bisa diangkat dari CRM) */}
                             {item.messageType === 'callLogMessage' && (
                               <div className="flex min-w-[200px] items-center gap-2.5 py-0.5">
                                 <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full', isMissedCall(item.messageText) ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-[#008069]')}>
                                   <CallIcon text={item.messageText} size={18} />
                                 </span>
                                 <div className="min-w-0">
                                   <p className={cn('text-sm font-semibold', isMissedCall(item.messageText) ? 'text-red-700' : 'text-[#111b21]')}>{item.messageText}</p>
                                   {/masuk$/.test(item.messageText ?? '') && <p className="text-xs text-[#667781]">Angkat dari HP WhatsApp brand</p>}
                                 </div>
                               </div>
                             )}
  
                             {/* Video Media Preview */}
                             {item.messageType === 'videoMessage' && (
                               <div className="mb-1.5 overflow-hidden rounded-xl max-w-[280px]">
                                 {item.mediaUrl ? (
                                   <div className="rounded-xl overflow-hidden bg-black border border-black/10">
                                     <video
                                       src={resolveMediaUrl(item.mediaUrl)}
                                       controls
                                       playsInline
                                       className="w-full rounded-xl max-h-[220px]"
                                       preload="metadata"
                                     />
                                   </div>
                                 ) : (
                                   <div className="flex items-center gap-2 rounded-lg bg-black/5 p-2 text-xs text-zinc-600">
                                     <ImageIcon size={16} className="shrink-0 text-purple-500" />
                                     <span className="font-semibold">Video</span>
                                   </div>
                                 )}
                               </div>
                             )}
  
                             {/* Audio / Voicenote Player */}
                             {(item.messageType === 'audioMessage' || item.messageType === 'pttMessage') && (
                               <div className="mb-1.5">
                                 {item.mediaUrl ? (
                                   <div className="flex items-center gap-2 rounded-2xl bg-black/5 p-2 min-w-[220px] max-w-[280px] border border-black/5">
                                     <div className="grid h-8 w-8 place-items-center rounded-full bg-emerald-100 text-emerald-700 shrink-0">
                                       <Mic size={16} />
                                     </div>
                                     <audio
                                       src={resolveMediaUrl(item.mediaUrl)}
                                       controls
                                       className="h-8 flex-1 outline-none min-w-0"
                                       preload="metadata"
                                     />
                                   </div>
                                 ) : (
                                   <div className="flex items-center gap-2 rounded-lg bg-black/5 p-2 text-xs text-zinc-600">
                                     <Mic size={16} className="shrink-0 text-amber-600" />
                                     <span className="font-semibold">Pesan Suara (Voice Note)</span>
                                   </div>
                                 )}
                               </div>
                             )}
  
                             {/* Document / File */}
                             {item.messageType === 'documentMessage' && (
                               <div className="mb-1.5">
                                 {item.mediaUrl ? (
                                   <a
                                     href={resolveMediaUrl(item.mediaUrl)}
                                     download={item.messageText || 'dokumen'}
                                     target="_blank"
                                     rel="noopener noreferrer"
                                     className="flex items-center justify-between gap-3 rounded-xl bg-black/5 p-2.5 text-xs hover:bg-black/10 transition border border-black/5 group"
                                     title="Klik untuk mengunduh berkas"
                                   >
                                     <div className="flex items-center gap-2.5 min-w-0">
                                       <div className="grid h-9 w-9 place-items-center rounded-lg bg-purple-100 text-purple-700 shrink-0">
                                         <FileText size={18} />
                                       </div>
                                       <div className="min-w-0">
                                         <p className="font-bold text-zinc-900 truncate max-w-[160px]">
                                           {item.messageText || 'Dokumen'}
                                         </p>
                                         <p className="text-xs text-zinc-500">Klik untuk mengunduh</p>
                                       </div>
                                     </div>
                                     <div className="grid h-7 w-7 place-items-center rounded-full bg-white text-zinc-600 shadow-2xs group-hover:text-[#00a884] shrink-0">
                                       <Download size={14} />
                                     </div>
                                   </a>
                                 ) : (
                                   <div className="flex items-center gap-2 rounded-lg bg-black/5 p-2 text-xs text-zinc-600">
                                     <FileText size={16} className="shrink-0 text-sky-600" />
                                     <span className="font-semibold">{item.messageText || 'Dokumen Berkas / PDF'}</span>
                                   </div>
                                 )}
                               </div>
                             )}
  
                             {Boolean(item.messageText) && item.messageType !== 'callLogMessage' &&
                               !['[Gambar]', '[Video]', '[Audio]', '[Voice Note]', '[Dokumen]', '[Stiker]', '[Lokasi]'].includes(item.messageText!.trim()) &&
                               // Pesan lama: foto/video yang tersimpan dengan nama berkas sebagai teks.
                               !(['imageMessage', 'videoMessage'].includes(item.messageType ?? '') && isMediaFileNameText(item.messageText!)) && (
                                 <p className="text-base md:text-[14px] leading-relaxed whitespace-pre-wrap break-words text-[#111b21] mt-1">
                                   {linkifyText(item.messageText!)}
                                 </p>
                             )}
                           </>
                         )}
  
                        {/* Timestamp & Read Receipts inside bubble */}
                        <span className="float-right ml-3 mt-1 inline-flex items-center gap-1 text-xs text-[#667781] select-none leading-none">
                          {item.isStarred && (
                            <span title="Pesan berbintang">
                              <Star size={11} className="fill-amber-400 text-amber-500" />
                            </span>
                          )}
                          {item.editedAt && !isMessageDeleted && <span className="italic">Diedit</span>}
                          <span>{formatBubbleTime(item.timestamp)}</span>
                          {item.isFromMe && !isMessageDeleted && (
                            item.status === 'failed' ? (
                              <span title="Gagal terkirim" className="text-red-500">
                                <AlertCircle size={12} />
                              </span>
                            ) : item.status === 'pending' ? (
                              <span title="Menunggu" className="text-[#8696a0]">
                                <Clock size={11} />
                              </span>
                            ) : item.status === 'sent' ? (
                              <span title="Terkirim" className="text-[#8696a0] inline-flex items-center">
                                <Check size={14} />
                              </span>
                            ) : (
                              <span title={item.status === 'read' ? 'Sudah dibaca' : 'Tersampaikan'} className="inline-flex items-center">
                                <CheckCheck
                                  size={15}
                                  className={item.status === 'read' ? 'text-[#53bdeb]' : 'text-[#8696a0]'}
                                />
                              </span>
                            )
                          )}
                        </span>
  
                        {/* Pinned Reaction Emoji Badge on Bubble */}
                        {item.reaction && !isMessageDeleted && (() => {
                          const isAdminUser = user?.role === 'superadmin' || user?.role === 'admin';
                          const isProspectReaction = item.reactionUserId === null && !item.isFromMe;
                          const isMyReaction = item.reactionUserId === user?.id;
                          const canRemoveReaction = !isProspectReaction && (isMyReaction || isAdminUser);
                          return (
                            <button
                              type="button"
                              disabled={!canRemoveReaction}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (canRemoveReaction) reactMutate({ messageId: item.id, emoji: item.reaction! });
                              }}
                              title={
                                isProspectReaction ? 'Reaksi dari jamaah' :
                                !isMyReaction && !isAdminUser ? 'Reaksi dari CS lain' :
                                'Klik untuk menghapus reaksi'
                              }
                              className={cn(
                                'absolute -bottom-2.5 right-2 flex items-center gap-0.5 rounded-full bg-white px-1.5 py-0.5 shadow-[0_1px_3px_rgba(0,0,0,0.15)] border border-black/10 select-none z-10 transition-all',
                                canRemoveReaction ? 'cursor-pointer hover:scale-110 active:scale-95' : 'cursor-default opacity-90'
                              )}
                            >
                              <span className="text-[13px] leading-none">{item.reaction}</span>
                            </button>
                          );
                        })()}
                      </div>
  
                      {!item.isFromMe && !isMessageDeleted && canSend && reactionTrigger}
                    </div>
                  );
                })()}
              </div>
  );
});

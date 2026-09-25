import { useEffect } from 'react';
import { AlertTriangle, Bell, CheckCircle2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { cn } from '../lib/cn';

export type ToastPriority = 'info' | 'action' | 'urgent';
export type AppToast = {
  id: string;
  title: string;
  body?: string | null;
  link?: string | null;
  priority: ToastPriority;
  /** `notification` = notifikasi in-app (ikon lonceng); `feedback` = hasil tindakan di halaman ini. */
  kind?: 'notification' | 'feedback';
  onOpen?(): void;
};

const MAX_TOASTS = 3;
const AUTO_DISMISS_MS = 6000;

type ToastState = { toasts: AppToast[]; push(toast: Omit<AppToast, 'id'> & { id?: string }): void; dismiss(id: string): void };

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => set((state) => {
    const id = toast.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Notifikasi ringkasan yang sama diganti, bukan ditumpuk; paling banyak 3 toast tampil.
    const rest = state.toasts.filter((t) => t.id !== id);
    return { toasts: [...rest, { ...toast, id }].slice(-MAX_TOASTS) };
  }),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export const pushToast = (toast: Omit<AppToast, 'id'> & { id?: string }) => useToastStore.getState().push(toast);

/**
 * Umpan balik tindakan (berhasil/gagal) di halaman mana pun, memakai satu tumpukan toast yang sama
 * dengan notifikasi agar posisinya tidak saling menimpa. Error tetap tampil sampai ditutup.
 */
export function showFeedback(message: string, options?: { error?: boolean }) {
  pushToast({ title: message, priority: options?.error ? 'urgent' : 'info', kind: 'feedback' });
}

function ToastItem({ toast }: { toast: AppToast }) {
  const dismiss = useToastStore((state) => state.dismiss);
  const navigate = useNavigate();
  const urgent = toast.priority === 'urgent';
  const feedback = toast.kind === 'feedback';

  useEffect(() => {
    // Mendesak tetap tampil sampai ditutup; lainnya hilang sendiri.
    if (urgent) return;
    const timer = setTimeout(() => dismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [dismiss, toast.id, urgent]);

  const open = () => {
    toast.onOpen?.();
    if (toast.link) navigate(toast.link);
    dismiss(toast.id);
  };

  return (
    <div
      role={urgent ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto flex w-[360px] max-w-[calc(100vw-2rem)] items-start gap-3 rounded-xl border px-4 py-3 shadow-lift animate-fade-up',
        urgent ? 'border-rose-700 bg-rose-700 text-white' : 'border-zinc-200 bg-white text-zinc-900',
      )}
    >
      {urgent
        ? <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        : feedback
          ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
          : <Bell size={16} className="mt-0.5 shrink-0 text-zinc-600" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        {toast.link || toast.onOpen ? (
          <button type="button" onClick={open} className="text-left text-sm font-semibold hover:underline">{toast.title}</button>
        ) : (
          <p className="text-sm font-semibold">{toast.title}</p>
        )}
        {toast.body && <p className={cn('mt-0.5 text-xs', urgent ? 'text-rose-50' : 'text-zinc-600')}>{toast.body}</p>}
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Tutup notifikasi"
        className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-md', urgent ? 'hover:bg-rose-800' : 'text-zinc-500 hover:bg-zinc-100')}
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** Toast global aplikasi (notifikasi realtime). Pojok kanan bawah, di atas konten. */
export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  return (
    // Tiap toast sudah membawa role status/alert sendiri; wadah tidak perlu live region kedua.
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2">
      {toasts.map((toast) => <ToastItem key={toast.id} toast={toast} />)}
    </div>
  );
}

// ── Rem banjir toast notifikasi ────────────────────────────────────────────────

const BURST_WINDOW_MS = 5000;
const BURST_LIMIT = 3;
const SUMMARY_ID = 'notification-burst';
let recentArrivals: { at: number; urgent: boolean }[] = [];
let summary: { total: number; urgent: number } | null = null;

type IncomingNotification = { id: number; title: string; body?: string | null; link?: string | null; priority: ToastPriority };

/**
 * Toast untuk notifikasi realtime. Hingga 3 notifikasi dalam 5 detik tampil satu per satu; bila lebih
 * (mis. setelah WhatsApp tersambung ulang dan banyak SLA terlewat), toast individual diganti SATU ringkasan
 * "N notifikasi baru · M mendesak" yang membuka panel — tidak ada yang hilang diam-diam dari layar.
 */
export function pushNotificationToast(notification: IncomingNotification, openPanel: () => void, now = Date.now()) {
  const store = useToastStore.getState();
  const urgent = notification.priority === 'urgent';
  recentArrivals = recentArrivals.filter((arrival) => now - arrival.at < BURST_WINDOW_MS);
  recentArrivals.push({ at: now, urgent });

  const summaryVisible = summary !== null && store.toasts.some((toast) => toast.id === SUMMARY_ID);
  if (!summaryVisible && recentArrivals.length <= BURST_LIMIT) {
    summary = null;
    store.push({ id: `notification-${notification.id}`, title: notification.title, body: notification.body, link: notification.link, priority: notification.priority });
    return 'single' as const;
  }

  summary = summaryVisible && summary
    ? { total: summary.total + 1, urgent: summary.urgent + (urgent ? 1 : 0) }
    : { total: recentArrivals.length, urgent: recentArrivals.filter((arrival) => arrival.urgent).length };
  useToastStore.setState({ toasts: store.toasts.filter((toast) => toast.kind === 'feedback' || toast.id === SUMMARY_ID) });
  store.push({
    id: SUMMARY_ID,
    title: `${summary.total} notifikasi baru`,
    body: summary.urgent ? `${summary.urgent} mendesak · buka untuk melihat semuanya` : 'Buka untuk melihat semuanya',
    priority: summary.urgent ? 'urgent' : 'action',
    onOpen: openPanel,
  });
  return 'summary' as const;
}

/** Untuk tes. */
export function resetNotificationBurst() {
  recentArrivals = [];
  summary = null;
}

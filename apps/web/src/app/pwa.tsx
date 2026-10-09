import { useEffect, useState, useSyncExternalStore } from 'react';
import { Download, WifiOff } from 'lucide-react';
import { Button } from '../components/ui/button';

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
let installEvent: InstallEvent | null = null;
const listeners = new Set<() => void>();
function notify() { listeners.forEach(listener => listener()); }
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installEvent = event as InstallEvent; notify(); });
window.addEventListener('appinstalled', () => { installEvent = null; notify(); });
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function InstallApp() {
  const available = useSyncExternalStore(subscribe, () => Boolean(installEvent));
  const [pending, setPending] = useState(false);
  const [hint, setHint] = useState('');
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  if (standalone) return null;
  async function install() {
    if (!installEvent) return;
    const event = installEvent;
    setPending(true);
    try { await event.prompt(); const result = await event.userChoice; setHint(result.outcome === 'accepted' ? 'Pemasangan dimulai.' : ''); }
    catch { setHint('Gunakan menu browser.'); }
    finally { installEvent = null; notify(); setPending(false); }
  }
  return <section className="surface flex items-center gap-3 p-3" aria-label="Pasang aplikasi">
    <Download size={20} aria-hidden="true" className="shrink-0 text-zinc-700" />
    <div className="min-w-0 flex-1">
      <h2 className="text-sm font-semibold">Pasang di layar utama</h2>
      {!available && <p className="text-xs text-zinc-500">Menu browser → Tambah ke Layar Utama</p>}
      {hint && <p role="status" className="text-xs text-zinc-500">{hint}</p>}
    </div>
    {available && <Button size="sm" onClick={() => void install()} disabled={pending}>{pending ? 'Memasang…' : 'Pasang'}</Button>}
  </section>;
}

export function NetworkBanner() {
  const online = useOnline();
  if (online) return null;
  return <div role="status" className="network-banner fixed inset-x-3 top-2 z-[100] flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 shadow-sm"><WifiOff size={18} className="shrink-0" aria-hidden="true" />Koneksi terputus. Draft tetap tersedia; pengiriman dan penyimpanan memerlukan internet.</div>;
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  return online;
}

export function registerAppWorker() {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js').catch(() => { /* Browser use remains available if installation is unsupported. */ });
  }
}

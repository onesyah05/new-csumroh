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
  if (standalone) return <p className="text-sm text-zinc-600">CRM Azhan dibuka sebagai aplikasi.</p>;
  async function install() {
    if (!installEvent) return;
    const event = installEvent;
    setPending(true);
    try { await event.prompt(); const result = await event.userChoice; setHint(result.outcome === 'accepted' ? 'Pemasangan dimulai.' : 'Anda dapat memasang aplikasi nanti.'); }
    catch { setHint('Buka menu browser untuk menambahkan CRM ke layar utama.'); }
    finally { installEvent = null; notify(); setPending(false); }
  }
  return <section className="surface space-y-3 p-4" aria-label="Pasang aplikasi">
    <h2 className="text-sm font-semibold">CRM di layar utama</h2>
    <p className="text-sm leading-relaxed text-zinc-600">Buka CRM dengan cepat dari ikon di HP Anda.</p>
    {available ? <Button onClick={() => void install()} disabled={pending}><Download size={16} aria-hidden="true" />{pending ? 'Memasang…' : 'Pasang CRM Azhan'}</Button>
      : <p className="text-sm leading-relaxed text-zinc-600">Di iPhone, buka menu Bagikan di Safari, lalu Tambah ke Layar Utama. Di Android, buka menu browser dan pilih Instal aplikasi atau Tambahkan ke layar utama bila tersedia.</p>}
    {hint && <p role="status" className="text-sm text-zinc-600">{hint}</p>}
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

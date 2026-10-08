import { pushToast } from './toast';

declare const __BUILD_ID__: string;

const CHECK_INTERVAL_MS = 5 * 60_000;
const RELOAD_GUARD_KEY = 'azhan-chunk-reload-at';
const RELOAD_GUARD_MS = 30_000;

/** Muat ulang sekali saja per jendela waktu, agar chunk yang memang hilang tidak membuat loop reload. */
function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_GUARD_MS) return;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch { /* storage tidak tersedia: lanjut muat ulang */ }
  window.location.reload();
}

async function checkVersion() {
  try {
    const response = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    const { id } = await response.json() as { id?: string };
    if (id && id !== __BUILD_ID__) {
      pushToast({ id: 'app-update', title: 'Versi baru tersedia. Muat ulang', priority: 'action', persistent: true, onOpen: () => window.location.reload() });
    }
  } catch { /* offline atau gagal: coba lagi nanti */ }
}

/** Deteksi build baru (saat aplikasi kembali dibuka dan berkala) dan pulihkan dari chunk lama yang sudah dihapus. */
export function watchForNewVersion() {
  if (!import.meta.env.PROD) return;
  window.addEventListener('vite:preloadError', (event) => { event.preventDefault(); reloadOnce(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void checkVersion(); });
  window.setInterval(() => { if (document.visibilityState === 'visible') void checkVersion(); }, CHECK_INTERVAL_MS);
  void checkVersion();
}

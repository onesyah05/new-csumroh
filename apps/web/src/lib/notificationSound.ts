/**
 * Bunyi notifikasi pendek (WebAudio, tanpa berkas audio). Bila user membuka beberapa tab, hanya tab
 * yang terakhir difokuskan yang berbunyi agar tidak terdengar berlapis.
 */
const TAB_KEY = 'notifications:sound-tab';
const tabId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());
let context: AudioContext | null = null;

function claimTab() {
  try { localStorage.setItem(TAB_KEY, tabId); } catch { /* penyimpanan diblokir: tab ini tetap boleh berbunyi */ }
}

function isSoundTab() {
  try {
    const owner = localStorage.getItem(TAB_KEY);
    return !owner || owner === tabId;
  } catch {
    return true;
  }
}

if (typeof window !== 'undefined') {
  claimTab();
  window.addEventListener('focus', claimTab);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') claimTab(); });
}

/** `force` untuk tombol "Uji suara": selalu berbunyi di tab ini (sekaligus membuka izin audio browser). */
export function playNotificationSound(options?: { urgent?: boolean; force?: boolean }) {
  if (!options?.force && !isSoundTab()) return false;
  try {
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return false;
    context ??= new AudioCtor();
    if (context.state === 'suspended') void context.resume();
    const start = context.currentTime;
    // Dua nada naik untuk Mendesak, satu nada untuk lainnya; volume rendah.
    const notes = options?.urgent ? [880, 1175] : [988];
    notes.forEach((frequency, index) => {
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      const at = start + index * 0.16;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
      oscillator.connect(gain).connect(context!.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.15);
    });
    return true;
  } catch {
    return false;
  }
}

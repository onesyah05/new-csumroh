/**
 * Bunyi notifikasi: berkas /sounds/notification.mp3 (dua kali untuk Mendesak). Bila berkas gagal diputar
 * (hilang atau diblokir autoplay), cadangannya nada pendek WebAudio. Bila user membuka beberapa tab, hanya tab
 * yang terakhir difokuskan yang berbunyi agar tidak terdengar berlapis.
 */
const TAB_KEY = 'notifications:sound-tab';
const SOUND_URL = '/sounds/notification.mp3';
/** Klip lebih lantang dari nada WebAudio lama (gain 0.12); volume ditekan agar tidak mengejutkan. */
const CLIP_VOLUME = 0.6;
const URGENT_REPEAT_MS = 450;
const tabId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());
let context: AudioContext | null = null;
let clip: HTMLAudioElement | null = null;

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

let lastPlayedAt = 0;
const MIN_GAP_MS = 2000;

/** Pemutar klip mp3. Resolve false bila gagal diputar. */
async function playClip(urgent: boolean) {
  if (typeof Audio === 'undefined') return false;
  clip ??= new Audio(SOUND_URL);
  clip.volume = CLIP_VOLUME;
  clip.currentTime = 0;
  await clip.play();
  if (urgent) {
    const again = clip;
    window.setTimeout(() => { again.currentTime = 0; void again.play().catch(() => undefined); }, URGENT_REPEAT_MS);
  }
  return true;
}

/** Pemutar nada cadangan: dua nada naik untuk Mendesak, satu nada untuk lainnya; volume rendah. */
function playFallbackTones(urgent: boolean) {
  try {
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return false;
    context ??= new AudioCtor();
    if (context.state === 'suspended') void context.resume();
    const start = context.currentTime;
    const notes = urgent ? [880, 1175] : [988];
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

/**
 * Memutar bunyi notifikasi; resolve true bila ada suara yang diputar (klip atau cadangan).
 * `force` untuk tombol "Uji suara": selalu berbunyi di tab ini (sekaligus membuka izin audio browser).
 */
export async function playNotificationSound(options?: { urgent?: boolean; force?: boolean }): Promise<boolean> {
  if (!options?.force && !isSoundTab()) return false;
  // Notifikasi beruntun: paling sering sekali per 2 detik agar tidak berisik.
  if (!options?.force && Date.now() - lastPlayedAt < MIN_GAP_MS) return false;
  lastPlayedAt = Date.now();
  const urgent = Boolean(options?.urgent);
  try {
    return await playClip(urgent);
  } catch {
    return playFallbackTones(urgent);
  }
}

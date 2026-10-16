const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 500;

const inflight = new Map<string, Promise<unknown>>();
const finished = new Map<string, { at: number; value: unknown }>();

function prune(now: number) {
  for (const [key, entry] of finished) if (now - entry.at > TTL_MS) finished.delete(key);
  // Batas keras: entri tertua dibuang lebih dulu (Map menjaga urutan sisip).
  for (const key of finished.keys()) {
    if (finished.size <= MAX_ENTRIES) break;
    finished.delete(key);
  }
}

/**
 * Jalankan `run` paling banyak sekali per kunci (10 menit). Permintaan ulang dengan kunci yang sama mengembalikan hasil
 * sebelumnya, atau menunggu permintaan yang masih berjalan, sehingga klien yang habis waktu lalu mencoba lagi (mis.
 * kirim media ke WhatsApp) tidak membuat pesan ganda. Yang gagal tidak disimpan: coba ulang tetap menjalankan ulang.
 * Disimpan di memori satu proses API; tanpa kunci, `run` dijalankan biasa.
 */
export async function idempotent<T>(key: string | undefined, run: () => Promise<T>): Promise<T> {
  if (!key) return run();
  const now = Date.now();
  prune(now);
  const done = finished.get(key);
  if (done) return done.value as T;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const promise = run()
    .then((value) => {
      finished.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** Hanya untuk tes. */
export function resetIdempotency() {
  inflight.clear();
  finished.clear();
}

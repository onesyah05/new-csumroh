type BatcherOptions = {
  delayMs: number;
  /** Data berat (Pipeline, Ringkasan): tidak dimuat ulang saat tab tersembunyi; ditunda sampai tab terlihat lagi. */
  onlyWhenVisible?: boolean;
  invalidate(key: string): void;
  isVisible?(): boolean;
};

/**
 * Menggabungkan permintaan muat ulang data dari event realtime: kunci yang sama dalam satu jendela waktu
 * hanya dimuat ulang sekali. `flush()` memuat segera (mis. tab kembali terlihat), `dispose()` membatalkan.
 */
export function createRefreshBatcher(options: BatcherOptions) {
  const keys = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const visible = options.isVisible ?? (() => typeof document === 'undefined' || document.visibilityState === 'visible');

  function run() {
    timer = null;
    // Tab tersembunyi: kunci tetap menunggu; `flush()` dipanggil saat tab terlihat.
    if (options.onlyWhenVisible && !visible()) return;
    const due = [...keys];
    keys.clear();
    for (const key of due) options.invalidate(key);
  }

  return {
    add(key: string) {
      keys.add(key);
      if (!timer) timer = setTimeout(run, options.delayMs);
    },
    /** Muat ulang sekarang (jika ada yang menunggu). */
    flush() {
      if (timer) clearTimeout(timer);
      if (keys.size) run();
      else timer = null;
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      keys.clear();
    },
    get pending() {
      return keys.size;
    },
  };
}

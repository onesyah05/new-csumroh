import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type OutboxItem = { pathname: string; payload: unknown };
/** delivered = diterima API; retry = API tidak terjangkau/sibuk, coba lagi; drop = ditolak permanen (payload tidak valid). */
export type SendResult = 'delivered' | 'retry' | 'drop';

type OutboxOptions = {
  baseDelayMs?: number;
  maxDelayMs?: number;
  onDrop?(item: OutboxItem, name: string): void;
};

/**
 * Antrean notifikasi gateway → API di disk. Pesan WhatsApp yang sudah diterima gateway tidak dikirim ulang oleh
 * WhatsApp, jadi setiap event disimpan dulu dan dikirim berurutan sampai API menerimanya — termasuk saat API sedang
 * restart (deploy) atau error sementara. API meng-upsert per messageId, sehingga kiriman ganda aman.
 */
export class Outbox {
  private queue: string[] = [];
  private seq = 0;
  private draining = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private failures = 0;

  constructor(
    private readonly dir: string,
    private readonly send: (item: OutboxItem) => Promise<SendResult>,
    private readonly options: OutboxOptions = {},
  ) {}

  /** Muat antrean yang tertinggal dari proses sebelumnya (mis. gateway restart saat API mati). */
  async init() {
    await mkdir(this.dir, { recursive: true });
    const files = await readdir(this.dir);
    // File .tmp = tulisan yang terputus di tengah jalan; isinya tidak lengkap.
    await Promise.all(files.filter((name) => name.endsWith('.tmp')).map((name) => rm(path.join(this.dir, name), { force: true })));
    this.queue.push(...files.filter((name) => name.endsWith('.json')).sort());
    this.kick();
  }

  get size() {
    return this.queue.length;
  }

  async enqueue(item: OutboxItem) {
    const name = `${String(Date.now()).padStart(15, '0')}-${String(this.seq++).padStart(9, '0')}.json`;
    const file = path.join(this.dir, name);
    // Tulis ke .tmp lalu rename: file .json di antrean selalu utuh.
    await writeFile(`${file}.tmp`, JSON.stringify(item));
    await rename(`${file}.tmp`, file);
    this.queue.push(name);
    this.kick();
  }

  private kick() {
    if (!this.draining && !this.retryTimer) void this.drain();
  }

  private scheduleRetry() {
    this.failures += 1;
    const delay = Math.min((this.options.baseDelayMs ?? 1000) * 2 ** (this.failures - 1), this.options.maxDelayMs ?? 30_000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.kick();
    }, delay);
    this.retryTimer.unref?.();
  }

  /** null = file hilang atau isinya rusak (tidak akan pernah terkirim); error lain = gangguan baca sementara. */
  private async readItem(file: string): Promise<OutboxItem | null> {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as OutboxItem;
    } catch (error) {
      if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /**
   * Kirim berurutan; berhenti di item pertama yang gagal dan coba lagi dengan jeda berlipat (1 dtk … 30 dtk).
   * Tidak pernah melempar error: gangguan disk juga dicoba ulang, agar gateway tidak mati karena unhandled rejection.
   */
  async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const name = this.queue[0]!;
        const file = path.join(this.dir, name);
        const item = await this.readItem(file);
        const result: SendResult = item ? await this.send(item).catch(() => 'retry' as const) : 'drop';
        if (result === 'retry') {
          this.scheduleRetry();
          return;
        }
        if (result === 'drop' && item) this.options.onDrop?.(item, name);
        // Event yang dibuang disimpan di dead/ agar bisa diperiksa atau dikirim ulang manual, bukan hilang.
        if (result === 'drop') {
          await mkdir(path.join(this.dir, 'dead'), { recursive: true });
          await rename(file, path.join(this.dir, 'dead', name)).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
          });
        } else {
          await rm(file, { force: true });
        }
        // Keluar dari antrean hanya setelah file selesai dipindah/dihapus.
        this.failures = 0;
        this.queue.shift();
      }
    } catch {
      this.scheduleRetry();
    } finally {
      this.draining = false;
    }
  }
}

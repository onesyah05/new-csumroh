import { businessDateKey } from '@csumroh/shared-types';
import { env } from '../config/env.js';
import {
  businessHour,
  claimOnce,
  customExpiringJob,
  eveningDigestJob,
  gatewayHealthJob,
  morningDigestJob,
  proofStaleJob,
  replySlaJob,
  releaseClaim,
  retentionJob,
  SLA,
  whatsappDisconnectedJob,
} from '../modules/notifications/jobs.js';
import { capiSyncJob } from '../modules/capi/capi.service.js';

const TICK_MS = 60_000;

type Job = { name: string; run(now: Date): Promise<unknown> };

/** Job tiap menit. */
const minuteJobs: Job[] = [
  { name: 'reply-sla', run: replySlaJob },
  { name: 'wa-disconnected', run: whatsappDisconnectedJob },
  { name: 'gateway-health', run: (now) => gatewayHealthJob(now) },
  { name: 'proof-stale', run: proofStaleJob },
  { name: 'custom-expiring', run: customExpiringJob },
];

/**
 * Job panjang yang bergantung pada layanan luar: dijalankan di latar tanpa ditunggu putaran menit, agar Meta yang
 * lambat (15 dtk per kiriman) tidak menunda SLA balasan atau cek gateway. Satu job tidak pernah jalan tumpang tindih.
 */
const backgroundJobs: Job[] = [
  // Retry + backfill event Meta CAPI; job sendiri hanya bekerja tiap 5 menit.
  { name: 'capi-sync', run: capiSyncJob },
];
const backgroundRunning = new Map<string, Promise<unknown>>();

function startBackgroundJob(job: Job, now: Date) {
  if (backgroundRunning.has(job.name)) return;
  backgroundRunning.set(job.name, runJob(job, now).finally(() => backgroundRunning.delete(job.name)));
}

/** Untuk test: tunggu job latar yang sedang berjalan. */
export async function backgroundJobsSettled() {
  await Promise.all(backgroundRunning.values());
}

/** Job harian: jalan sekali per tanggal WIB setelah jamnya tiba (juga menyusul bila API baru hidup). */
const dailyJobs: (Job & { hour: number })[] = [
  { name: 'morning-digest', hour: SLA.morningHour, run: morningDigestJob },
  { name: 'evening-digest', hour: SLA.eveningHour, run: eveningDigestJob },
  { name: 'retention', hour: SLA.retentionHour, run: retentionJob },
];

/** true bila job selesai tanpa galat. */
async function runJob(job: Job, now: Date) {
  const started = Date.now();
  let ok = true;
  try {
    await job.run(now);
  } catch (error) {
    ok = false;
    console.error(`Job ${job.name} gagal`, error);
  }
  const elapsed = Date.now() - started;
  if (elapsed > 10_000) console.warn(`Job ${job.name} lambat: ${elapsed} ms`);
  return ok;
}

/** Percobaan job harian per hari (di memori): job yang gagal dicoba ulang, tetapi tidak tanpa batas. */
const DAILY_MAX_ATTEMPTS = 3;
const dailyAttempts = new Map<string, number>();

/**
 * Satu putaran scheduler. Kunci per menit di tabel dedupe memastikan hanya satu proses API yang
 * menjalankan putaran ini walaupun kelak ada beberapa proses.
 */
export async function runTick(now = new Date()) {
  if (!(await claimOnce(`scheduler:tick:${Math.floor(now.getTime() / TICK_MS)}`))) return false;
  for (const job of backgroundJobs) startBackgroundJob(job, now);
  for (const job of minuteJobs) await runJob(job, now);
  const today = businessDateKey(now);
  const hour = businessHour(now);
  for (const job of dailyJobs) {
    if (hour < job.hour) continue;
    const claimKey = `scheduler:daily:${job.name}:${today}`;
    if (!(await claimOnce(claimKey))) continue;
    const attemptKey = `${job.name}:${today}`;
    const attempts = (dailyAttempts.get(attemptKey) ?? 0) + 1;
    dailyAttempts.set(attemptKey, attempts);
    if (dailyAttempts.size > 50) for (const key of dailyAttempts.keys()) if (!key.endsWith(`:${today}`)) dailyAttempts.delete(key);
    const ok = await runJob(job, now);
    // Gagal (mis. database atau layanan luar sedang bermasalah): klaim dilepas agar putaran berikutnya mencoba lagi.
    if (!ok && attempts < DAILY_MAX_ATTEMPTS) await releaseClaim(claimKey);
  }
  return true;
}

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;

export function startScheduler() {
  // NOTIFICATIONS_ENABLED tidak mematikan scheduler: pengiriman notifikasi sudah dimatikan di notify.service,
  // sedangkan job lain (retry CAPI) tetap harus jalan.
  if (!env.SCHEDULER_ENABLED || timer) return;
  const tick = async () => {
    // Putaran yang masih berjalan tidak ditumpuk.
    if (running) return;
    running = true;
    try {
      await runTick();
    } catch (error) {
      console.error('Scheduler gagal', error);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void tick(), 15_000).unref?.();
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
  console.log('Scheduler aktif (tiap 60 detik)');
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = undefined;
}

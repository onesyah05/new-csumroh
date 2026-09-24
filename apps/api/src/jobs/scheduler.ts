import { businessDateKey } from '@csumroh/shared-types';
import { env } from '../config/env.js';
import {
  businessHour,
  claimOnce,
  eveningDigestJob,
  gatewayHealthJob,
  morningDigestJob,
  proofStaleJob,
  replySlaJob,
  retentionJob,
  SLA,
  whatsappDisconnectedJob,
} from '../modules/notifications/jobs.js';

const TICK_MS = 60_000;

type Job = { name: string; run(now: Date): Promise<unknown> };

/** Job tiap menit. */
const minuteJobs: Job[] = [
  { name: 'reply-sla', run: replySlaJob },
  { name: 'wa-disconnected', run: whatsappDisconnectedJob },
  { name: 'gateway-health', run: (now) => gatewayHealthJob(now) },
  { name: 'proof-stale', run: proofStaleJob },
];

/** Job harian: jalan sekali per tanggal WIB setelah jamnya tiba (juga menyusul bila API baru hidup). */
const dailyJobs: (Job & { hour: number })[] = [
  { name: 'morning-digest', hour: SLA.morningHour, run: morningDigestJob },
  { name: 'evening-digest', hour: SLA.eveningHour, run: eveningDigestJob },
  { name: 'retention', hour: SLA.retentionHour, run: retentionJob },
];

async function runJob(job: Job, now: Date) {
  const started = Date.now();
  try {
    await job.run(now);
  } catch (error) {
    console.error(`Job ${job.name} gagal`, error);
  }
  const elapsed = Date.now() - started;
  if (elapsed > 10_000) console.warn(`Job ${job.name} lambat: ${elapsed} ms`);
}

/**
 * Satu putaran scheduler. Kunci per menit di tabel dedupe memastikan hanya satu proses API yang
 * menjalankan putaran ini walaupun kelak ada beberapa proses.
 */
export async function runTick(now = new Date()) {
  if (!(await claimOnce(`scheduler:tick:${Math.floor(now.getTime() / TICK_MS)}`))) return false;
  for (const job of minuteJobs) await runJob(job, now);
  const today = businessDateKey(now);
  const hour = businessHour(now);
  for (const job of dailyJobs) {
    if (hour >= job.hour && (await claimOnce(`scheduler:daily:${job.name}:${today}`))) await runJob(job, now);
  }
  return true;
}

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;

export function startScheduler() {
  if (!env.SCHEDULER_ENABLED || !env.NOTIFICATIONS_ENABLED || timer) return;
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
  console.log('Scheduler notifikasi aktif (tiap 60 detik)');
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = undefined;
}

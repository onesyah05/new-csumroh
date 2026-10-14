import { env } from '../../config/env.js';

/**
 * Pengiriman nyata ke Meta (event CAPI, audiens spam) hanya di production. Lingkungan test memakai fetch palsu.
 * Pengembang yang memang perlu mengirim dari lokal harus menyalakan META_ALLOW_NON_PRODUCTION=true secara sadar.
 */
export function isMetaSendingAllowed(nodeEnv: string = env.NODE_ENV, allowFlag: boolean = env.META_ALLOW_NON_PRODUCTION) {
  return nodeEnv === 'production' || nodeEnv === 'test' || allowFlag;
}

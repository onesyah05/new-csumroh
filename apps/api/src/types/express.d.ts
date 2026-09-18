import type { SessionUser } from '@csumroh/shared-types';

declare global {
  namespace Express {
    interface Request { user?: SessionUser }
  }
}

export {};

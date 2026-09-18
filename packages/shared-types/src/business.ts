import type { ProspectStatus } from './contracts.js';

export function canTransitionStatus(_from: ProspectStatus, _to: ProspectStatus) {
  // Pipeline is an operational board: agents may correct, skip, or move a
  // prospect backwards when the real conversation changes direction.
  return true;
}

export type RoomPrices = { quad?: number; triple?: number; double?: number; infant?: number };
export type PaxCounts = { quad?: number; triple?: number; double?: number; infant?: number };

export function calculateDealValue(prices: RoomPrices, pax: PaxCounts) {
  return (['quad', 'triple', 'double', 'infant'] as const).reduce((total, room) => {
    const price = Math.max(0, prices[room] ?? 0);
    const count = Math.max(0, Math.trunc(pax[room] ?? 0));
    return total + price * count;
  }, 0);
}

export const tgjpSteps = ['terima', 'gali', 'jawab', 'pastikan'] as const;
export type TgjpStep = (typeof tgjpSteps)[number];

export function nextTgjpStep(current: TgjpStep): TgjpStep | null {
  const index = tgjpSteps.indexOf(current);
  return tgjpSteps[index + 1] ?? null;
}

export const capiEventForStatus = (status: ProspectStatus) =>
  ({ new: 'Contact', offered: 'AddToCart', closing: 'InitiateCheckout', closed_won: 'Purchase' })[
    status as 'new' | 'offered' | 'closing' | 'closed_won'
  ] ?? null;

/**
 * PolicyPeakPeriodProvider — the v1 PeakPeriodProvider.
 *
 * It wraps the pure calendar math in `definition/peak.js` with a policy lookup
 * that knows which years have a real holiday calendar. It reports periods and
 * transitions only; it never touches money.
 */

import { assertPeakPeriodProvider } from '../definition/seam.js';
import { describePeriod, getNextTransition, getRemainingSeconds } from '../definition/peak.js';
import { policyForAt } from '../definition/policy/index.js';

/**
 * @param {{policyLookup?: (atMs:number) => {policy: import('../definition/peak.js').PeriodPolicy, estimated: boolean}}} [options]
 * @returns {import('../definition/seam.js').PeakPeriodProvider}
 */
export function createPolicyPeakPeriodProvider(options = {}) {
  const lookup = options.policyLookup ?? policyForAt;

  /** @param {number} atMs */
  const getCurrentPeriod = (atMs) => {
    const { policy, estimated } = lookup(atMs);
    const described = describePeriod(policy, atMs);
    return {
      kind: described.kind,
      label: described.kind === 'peak' ? '高峰' : '空闲',
      ratioOfPeak: described.kind === 'peak' ? 1 : policy.offPeakRatioOfPeak,
      calendarYear: policy.year,
      estimated: estimated || policy.estimated === true,
      nextTransitionAt: described.next,
      remainingSeconds: described.remainingSeconds,
      upcoming: described.to,
    };
  };

  /** @param {number} atMs */
  const nextTransition = (atMs) => getNextTransition(lookup(atMs).policy, atMs);
  /** @param {number} atMs */
  const remaining = (atMs) => getRemainingSeconds(lookup(atMs).policy, atMs);

  return assertPeakPeriodProvider({
    getCurrentPeriod,
    getNextTransition: nextTransition,
    getRemainingSeconds: remaining,
  });
}

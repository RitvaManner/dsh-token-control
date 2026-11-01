/**
 * Policy registry. Adding a year = dropping in one `policy-YYYY.js` file and one
 * line here; nothing else changes.
 *
 * A year without a policy degrades to a documented estimate: Mon-Fri inside the
 * standard windows is peak, no holidays, and every period carries
 * `estimated: true` so the UI can say "按工作日估算" instead of pretending.
 */

import { beijingYear } from '../peak.js';
import { POLICY_2026 } from './policy-2026.js';

/** @type {Map<number, import('../peak.js').PeriodPolicy>} */
export const POLICY_REGISTRY = new Map([[2026, POLICY_2026]]);

export const SUPPORTED_YEARS = Object.freeze([...POLICY_REGISTRY.keys()].sort((a, b) => a - b));

/**
 * The estimate used when a year has no policy file. It is deliberately built
 * from the documented peak windows but carries no holiday knowledge.
 *
 * @param {number} year
 * @returns {import('../peak.js').PeriodPolicy}
 */
export function estimatedPolicy(year) {
  return {
    year,
    timeZone: 'Asia/Shanghai',
    source: null,
    publishedAt: null,
    peakWindows: [
      ['09:00', '12:00'],
      ['14:00', '18:00'],
    ],
    offPeakRatioOfPeak: 0.5,
    holidays: [],
    makeUpWorkdays: [],
    estimated: true,
  };
}

/**
 * @param {number} atMs
 * @returns {{policy: import('../peak.js').PeriodPolicy, estimated: boolean}}
 */
export function policyForAt(atMs) {
  const year = beijingYear(atMs);
  const policy = POLICY_REGISTRY.get(year);
  if (policy !== undefined) return { policy, estimated: false };
  return { policy: estimatedPolicy(year), estimated: true };
}

/**
 * @param {number} year
 * @returns {{policy: import('../peak.js').PeriodPolicy, estimated: boolean}}
 */
export function policyForYear(year) {
  const policy = POLICY_REGISTRY.get(year);
  if (policy !== undefined) return { policy, estimated: false };
  return { policy: estimatedPolicy(year), estimated: true };
}

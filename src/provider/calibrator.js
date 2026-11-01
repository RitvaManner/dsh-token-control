/**
 * Balance-difference calibration, kept deliberately conservative.
 *
 * The price table is the primary source. A balance delta observed across one
 * settled turn is a noisy measurement: the wallet also pays for Search/Fetch,
 * granted balance is consumed first, and refreshes may straddle other traffic.
 * So we learn a slow exponential ratio and clamp it, rather than trusting a
 * single delta.
 *
 * The ratio is applied to FUTURE displays only; it never rewrites the balance
 * number the API reported.
 */

import { clampRatio } from '../definition/money.js';

/**
 * @param {{alpha?: number, min?: number, max?: number, minComputedMicro?: number}} [options]
 */
export function createCalibrator(options = {}) {
  const alpha = Number.isFinite(options.alpha) ? Number(options.alpha) : 0.3;
  const min = Number.isFinite(options.min) ? Number(options.min) : 0.5;
  const max = Number.isFinite(options.max) ? Number(options.max) : 2;
  const minComputedMicro = Number.isFinite(options.minComputedMicro) ? Number(options.minComputedMicro) : 1000;

  let factor = 1;
  let samples = 0;

  /**
   * @param {{computedMicro:number, balanceBeforeCNY:number, balanceAfterCNY:number}} observation
   * @returns {boolean} whether this observation was usable
   */
  function observe(observation) {
    const computed = Number(observation.computedMicro);
    const before = Number(observation.balanceBeforeCNY);
    const after = Number(observation.balanceAfterCNY);
    if (!Number.isFinite(computed) || computed < minComputedMicro) return false;
    if (!Number.isFinite(before) || !Number.isFinite(after)) return false;
    const deltaMicro = Math.round((before - after) * 1e6);
    // A refund/credit makes the delta meaningless for calibration.
    if (deltaMicro <= 0) return false;
    const observed = deltaMicro / computed;
    factor = clampRatio(factor * (1 - alpha) + observed * alpha, min, max, factor);
    samples += 1;
    return true;
  }

  /**
   * @param {number} micro
   * @returns {number}
   */
  function apply(micro) {
    const value = Number(micro);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.round(value * factor);
  }

  return {
    observe,
    apply,
    state() {
      return { factor, samples, applied: samples > 0 && Math.abs(factor - 1) > 1e-9 };
    },
  };
}

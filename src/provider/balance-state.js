/**
 * BalanceState — holds the last known balance and the fact that it may be old.
 *
 * Rules from the requirement:
 *  - a failed refresh KEEPS the previous reading and marks it stale;
 *  - the UI always learns when the reading was taken;
 *  - concurrent refreshes collapse into one in-flight request.
 */

import { ERROR_CODES } from '../definition/protocol.js';

/**
 * @typedef {object} BalanceSnapshot
 * @property {'ok'|'stale'|'unconfigured'|'error'} state
 * @property {number|null} amountCNY
 * @property {number|null} updatedAt
 * @property {number|null} staleSeconds
 * @property {string|null} source
 * @property {{code:string}|null} error
 */

/**
 * @param {{provider: import('../definition/seam.js').BalanceProvider,
 *   now?: () => number, onChanged?: (snapshot:BalanceSnapshot) => void}} options
 */
export function createBalanceState({ provider, now = Date.now, onChanged = () => {} }) {
  /** @type {{amountCNY:number, atMs:number, source:string}|null} */
  let last = null;
  /** @type {{code:string}|null} */
  let error = null;
  let everFetched = false;
  /** @type {Promise<BalanceSnapshot>|null} */
  let inflight = null;
  /** @type {AbortController|null} */
  let controller = null;

  /** @returns {BalanceSnapshot} */
  const snapshot = () => {
    const nowMs = now();
    const staleSeconds = last === null ? null : Math.max(0, Math.floor((nowMs - last.atMs) / 1000));
    if (last === null) {
      return {
        state: error === null ? 'unconfigured' : 'error',
        amountCNY: null,
        updatedAt: null,
        staleSeconds,
        source: null,
        error,
      };
    }
    const stale = error !== null || staleSeconds > 120;
    return {
      state: stale ? 'stale' : 'ok',
      amountCNY: last.amountCNY,
      updatedAt: last.atMs,
      staleSeconds,
      source: last.source,
      error,
    };
  };

  /** @returns {Promise<BalanceSnapshot>} */
  async function refresh() {
    if (inflight !== null) return inflight;
    controller = new AbortController();
    inflight = (async () => {
      try {
        const reading = await provider.fetch(controller.signal);
        last = { amountCNY: reading.amountCNY, atMs: reading.atMs, source: reading.source };
        error = null;
        everFetched = true;
      } catch (cause) {
        const code = typeof (/** @type {{code?:unknown}} */ (cause)?.code) === 'string'
          ? String(/** @type {{code?:string}} */ (cause).code)
          : ERROR_CODES.network;
        error = { code };
        // Keep `last` on purpose: a failed refresh must not blank the balance.
      } finally {
        inflight = null;
        controller = null;
      }
      const next = snapshot();
      onChanged(next);
      return next;
    })();
    return inflight;
  }

  const cancel = () => {
    controller?.abort();
  };

  return {
    refresh,
    snapshot,
    cancel,
    get everFetched() {
      return everFetched;
    },
  };
}

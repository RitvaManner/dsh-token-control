/**
 * FallbackBalanceProvider — asks the API-key provider first and consults the
 * account provider only when there is no key at all.
 *
 * That keeps the documented behaviour for a `DEEPSEEK_API_KEY`: it is the
 * source that answers. A profile signed in through the DeepSeek account has no
 * key, so `no-credential` is the one answer worth asking a second source
 * about. Every other failure is the primary's real answer and is rethrown
 * unchanged, so a key that exists can never silently switch source.
 */

import { ERROR_CODES } from '../definition/protocol.js';
import { assertBalanceProvider } from '../definition/seam.js';

/**
 * @param {{primary: import('../definition/seam.js').BalanceProvider,
 *   fallback: import('../definition/seam.js').BalanceProvider}} options
 * @returns {import('../definition/seam.js').BalanceProvider}
 */
export function createFallbackBalanceProvider(options) {
  const { primary, fallback } = options;

  /** @param {AbortSignal} signal */
  const fetchBalance = async (signal) => {
    try {
      return await primary.fetch(signal);
    } catch (cause) {
      const code = typeof (/** @type {{code?:unknown}} */ (cause)?.code) === 'string'
        ? String(/** @type {{code?:string}} */ (cause).code)
        : '';
      if (code !== ERROR_CODES.noCredential) throw cause;
      return fallback.fetch(signal);
    }
  };

  return assertBalanceProvider({
    id: primary.id,
    label: primary.label,
    fetch: fetchBalance,
  });
}

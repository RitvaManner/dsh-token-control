/**
 * DeepSeekBalanceProvider — the v1 BalanceProvider.
 *
 * The API key never leaves this module: it is resolved through the Host-only
 * `ctx.credentials` service (provider store -> environment -> .env) on every
 * call, sent only in the outbound Authorization header, and never returned,
 * logged, or embedded in an error.
 *
 * Endpoint: GET https://api.deepseek.com/user/balance
 * Response: { is_available, balance_infos: [{ currency, total_balance,
 *             granted_balance, topped_up_balance }] }
 */

import { ERROR_CODES } from '../definition/protocol.js';
import { assertBalanceProvider } from '../definition/seam.js';

export const DEFAULT_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_KEY_REF = 'DEEPSEEK_API_KEY';

/**
 * @param {string} code
 * @param {string} message
 * @returns {Error & {code:string}}
 */
function balanceError(code, message) {
  const error = /** @type {Error & {code:string}} */ (new Error(message));
  error.code = code;
  return error;
}

/**
 * @param {number} status
 * @returns {string}
 */
function statusCode(status) {
  if (status === 401) return ERROR_CODES.httpUnauthorized;
  if (status === 403) return ERROR_CODES.httpForbidden;
  if (status === 429) return ERROR_CODES.httpRateLimited;
  if (status >= 500) return ERROR_CODES.httpServer;
  return ERROR_CODES.badPayload;
}

/**
 * Pull the CNY wallet out of the documented response shape without trusting it.
 * @param {unknown} payload
 * @returns {number}
 */
export function readCnyBalance(payload) {
  if (payload === null || typeof payload !== 'object') throw balanceError(ERROR_CODES.badPayload, 'balance response is not an object');
  const infos = /** @type {{balance_infos?: unknown}} */ (payload).balance_infos;
  if (!Array.isArray(infos)) throw balanceError(ERROR_CODES.badPayload, 'balance response has no balance_infos array');
  for (const entry of infos) {
    if (entry === null || typeof entry !== 'object') continue;
    const wallet = /** @type {{currency?: unknown, total_balance?: unknown}} */ (entry);
    if (wallet.currency !== 'CNY') continue;
    const amount = Number.parseFloat(String(wallet.total_balance));
    if (!Number.isFinite(amount)) throw balanceError(ERROR_CODES.badPayload, 'CNY wallet has a non-numeric total_balance');
    return amount;
  }
  throw balanceError(ERROR_CODES.badPayload, 'balance response has no CNY wallet');
}

/**
 * @param {{credentials: {resolve: (ref:string) => Promise<{value:string}|undefined>},
 *   fetchImpl?: typeof fetch, baseUrl?: string, keyRef?: string,
 *   timeoutMs?: number, now?: () => number}} options
 * @returns {import('../definition/seam.js').BalanceProvider}
 */
export function createDeepSeekBalanceProvider(options) {
  const {
    credentials,
    fetchImpl = globalThis.fetch,
    baseUrl = DEFAULT_BASE_URL,
    keyRef = DEFAULT_KEY_REF,
    timeoutMs = 8000,
    now = Date.now,
  } = options;

  if (typeof fetchImpl !== 'function') throw new TypeError('DeepSeekBalanceProvider needs a fetch implementation');

  /** @param {AbortSignal} outer */
  const fetchBalance = async (outer) => {
    const resolved = await credentials.resolve(keyRef);
    if (resolved === undefined || resolved.value === '') {
      throw balanceError(ERROR_CODES.noCredential, 'no DeepSeek API key is configured on the Host');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    if (outer !== undefined) outer.addEventListener('abort', onOuterAbort, { once: true });

    let response;
    try {
      response = await fetchImpl(`${baseUrl}/user/balance`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${resolved.value}`,
          accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = /** @type {{name?:string}} */ (error)?.name === 'AbortError';
      throw balanceError(aborted ? ERROR_CODES.timeout : ERROR_CODES.network, 'balance request failed');
    } finally {
      clearTimeout(timer);
      if (outer !== undefined) outer.removeEventListener('abort', onOuterAbort);
    }

    if (!response.ok) {
      // Drain without reading the body: upstream text must not reach the browser.
      try {
        await response.arrayBuffer();
      } catch {
        /* ignore */
      }
      throw balanceError(statusCode(response.status), `balance request rejected with HTTP ${String(response.status)}`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw balanceError(ERROR_CODES.badPayload, 'balance response was not JSON');
    }
    return {
      amountCNY: readCnyBalance(payload),
      currency: /** @type {'CNY'} */ ('CNY'),
      atMs: now(),
      source: 'deepseek-api',
    };
  };

  return assertBalanceProvider({
    id: 'deepseek',
    label: 'DeepSeek 余额',
    fetch: fetchBalance,
  });
}

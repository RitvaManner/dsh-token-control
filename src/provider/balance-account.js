/**
 * AccountBalanceProvider — the wallet of the signed-in DeepSeek account.
 *
 * A profile signed in through the DeepSeek account has no `DEEPSEEK_API_KEY`,
 * but DSH already holds the platform grant and reads the wallet for its own
 * settings page. `ctx.get('deepseekAccount')` exposes that Host-side service,
 * and `getBalance(client)` answers the recharge and bonus wallets without
 * handing the token to this plugin.
 *
 * The service is optional. On a profile without
 * `@deepseek-ai/dsh-deepseek-account` the lookup misses, the provider fails
 * with `no-credential`, and the readout keeps saying "未配置" instead of
 * inventing a number — the same degradation the API-key provider has.
 */

import { createRequire } from 'node:module';

import { ERROR_CODES } from '../definition/protocol.js';
import { assertBalanceProvider } from '../definition/seam.js';

export const ACCOUNT_SOURCE = 'deepseek-account';

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
 * The identity `DeepSeekAccount.getBalance` forwards to the Platform. A Host
 * caller has no browser, so the desktop build version stands in for the page
 * and the local language and time zone stand in for the browser's.
 *
 * @returns {{version:string, locale:string, timezoneOffsetSeconds:number}}
 */
export function accountClientMetadata() {
  return {
    version: desktopVersion(),
    locale: currentLocale(),
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  };
}

/**
 * @returns {string} the Desktop build version, or `0.0.0` outside Electron.
 */
function desktopVersion() {
  const fromEnv = process.env.DSH_CLIENT_VERSION;
  if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv;
  try {
    const electron = createRequire(import.meta.url)('electron');
    const version = electron?.app?.getVersion?.();
    if (typeof version === 'string' && version !== '') return version;
  } catch {
    /* not running inside Electron */
  }
  return '0.0.0';
}

/** @returns {string} the Host's locale, defaulting to `en-US`. */
function currentLocale() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
  } catch {
    return 'en-US';
  }
}

/**
 * The wallet lists in a `getBalance` outcome, without trusting its shape: the
 * service mirrors a Platform response, so a missing list is normal and a
 * non-array is not worth crashing over.
 *
 * @param {unknown} value
 * @returns {{currency?:unknown, balance?:unknown}[]}
 */
function walletsOf(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((wallet) => wallet !== null && typeof wallet === 'object');
}

/**
 * Reduce a `getBalance` outcome to one CNY total.
 *
 * `null` means nobody is signed in (the service answers `null` rather than
 * throwing); a non-`ready` status means the service could not read the wallet.
 *
 * @param {unknown} outcome
 * @returns {number}
 */
export function sumAccountCny(outcome) {
  if (outcome === null || outcome === undefined) {
    throw balanceError(ERROR_CODES.noCredential, 'no DeepSeek account is signed in');
  }
  if (typeof outcome !== 'object') {
    throw balanceError(ERROR_CODES.badPayload, 'account balance outcome is not an object');
  }
  const detail = /** @type {{status?:unknown, value?:unknown, bonusWallets?:unknown}} */ (outcome);
  if (detail.status !== 'ready') throw balanceError(ERROR_CODES.network, 'account balance query failed');

  let total = 0;
  let found = false;
  for (const wallet of [...walletsOf(detail.value), ...walletsOf(detail.bonusWallets)]) {
    if (wallet.currency !== 'CNY') continue;
    const amount = Number.parseFloat(String(wallet.balance));
    if (!Number.isFinite(amount)) throw balanceError(ERROR_CODES.badPayload, 'account CNY wallet has a non-numeric balance');
    total += amount;
    found = true;
  }
  if (!found) throw balanceError(ERROR_CODES.badPayload, 'account has no CNY wallet');
  // The wallets are decimal strings; summing them carries binary noise, so the
  // reading is rounded to the four decimals a Platform balance carries.
  return Math.round(total * 1e4) / 1e4;
}

/**
 * @param {{getAccount: () => unknown,
 *   client?: () => {version:string, locale:string, timezoneOffsetSeconds:number},
 *   now?: () => number}} options
 * @returns {import('../definition/seam.js').BalanceProvider}
 */
export function createAccountBalanceProvider(options) {
  const { getAccount, client = accountClientMetadata, now = Date.now } = options;

  /** @param {AbortSignal} signal */
  const fetchBalance = async (signal) => {
    void signal;
    const account = getAccount();
    if (account === null || account === undefined || typeof (/** @type {{getBalance?:unknown}} */ (account).getBalance) !== 'function') {
      throw balanceError(ERROR_CODES.noCredential, 'no DeepSeek account service is available on the Host');
    }

    let outcome;
    try {
      outcome = await /** @type {{getBalance: (client:unknown) => Promise<unknown>}} */ (account).getBalance(client());
    } catch {
      // The service reports expiry and protocol trouble by throwing; none of it
      // is the readout's business, so it collapses into one retryable code.
      throw balanceError(ERROR_CODES.network, 'account balance query failed');
    }

    return {
      amountCNY: sumAccountCny(outcome),
      currency: /** @type {'CNY'} */ ('CNY'),
      atMs: now(),
      source: ACCOUNT_SOURCE,
    };
  };

  return assertBalanceProvider({
    id: ACCOUNT_SOURCE,
    label: 'DeepSeek 余额',
    fetch: fetchBalance,
  });
}

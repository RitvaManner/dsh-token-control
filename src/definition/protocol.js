/**
 * Wire protocol between the Host half and the Client half.
 *
 * The Client bundle is a classic script and cannot import this module, so the
 * same constants are mirrored in `src/client/client.js`. `tests/architecture
 * .test.mjs` asserts both copies agree, so a change on one side without the
 * other fails the suite instead of silently breaking the readout.
 */

/** Bumped only for a breaking wire change. */
export const PROTOCOL_VERSION = 1;

/** ViewModel schema version. Fields are only ever ADDED within a version. */
export const VIEW_MODEL_SCHEMA_VERSION = 1;

/** Every route this plugin owns lives under this prefix. */
export const ROUTE_PREFIX = '/api/dsh-token-control/v1';

export const ROUTES = Object.freeze({
  snapshot: `${ROUTE_PREFIX}/snapshot`,
  stream: `${ROUTE_PREFIX}/stream`,
  viewConfig: `${ROUTE_PREFIX}/view-config`,
  balanceRefresh: `${ROUTE_PREFIX}/balance/refresh`,
  viewsManifest: `${ROUTE_PREFIX}/assets/views/index.json`,
  viewsAssetPrefix: `${ROUTE_PREFIX}/assets/views/`,
});

/** SSE event names. */
export const SSE_EVENT_FRAME = 'frame';
export const SSE_EVENT_RESET = 'reset';

/** Error codes that may cross the wire. Never include messages from upstream. */
export const ERROR_CODES = Object.freeze({
  badRequest: 'bad-request',
  unknownRoute: 'unknown-route',
  unknownSession: 'unknown-session',
  noCredential: 'no-credential',
  httpUnauthorized: 'http-401',
  httpForbidden: 'http-403',
  httpRateLimited: 'http-429',
  httpServer: 'http-5xx',
  network: 'network',
  badPayload: 'bad-payload',
  timeout: 'timeout',
  notModified: 'not-modified',
});

/** Top-level ViewModel sections, in broadcast/diff order. */
export const VIEW_MODEL_SECTIONS = Object.freeze([
  'schemaVersion',
  'sessionId',
  'turn',
  'session',
  'balance',
  'period',
  'meta',
]);

/**
 * @param {string} s
 * @returns {boolean} true when `s` is a plausible Session id for this protocol.
 */
export function isSessionId(s) {
  return typeof s === 'string' && s.length > 0 && s.length <= 200 && !/[\\/\u0000]/.test(s);
}

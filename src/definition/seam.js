/**
 * The seams. Everything replaceable is described HERE and nowhere else; the
 * concrete implementations live in `src/provider/` and are injected at
 * composition time by `src/host/`.
 *
 * Dependency rule enforced by tests/architecture.test.mjs:
 *   definition  <- provider
 *   definition  <- consumer        (consumer receives provider INSTANCES)
 *   definition  <- host / client
 * `provider` never imports `consumer`; `consumer` never imports `provider`.
 *
 * @typedef {import('./tokens.js').TokenBuckets} TokenBuckets
 * @typedef {'peak'|'idle'} PeriodKind
 */

/**
 * Tells time-of-day semantics only. It never prices anything: money is the
 * PricingStrategy's job, and it asks this provider at settlement time.
 *
 * @typedef {object} PeakPeriodProvider
 * @property {(atMs:number) => {kind:PeriodKind, label:string, ratioOfPeak:number,
 *   calendarYear:number, estimated:boolean, nextTransitionAt:number,
 *   remainingSeconds:number, upcoming:PeriodKind}} getCurrentPeriod
 * @property {(atMs:number) => {atMs:number, to:PeriodKind}} getNextTransition
 * @property {(atMs:number) => number} getRemainingSeconds
 */

/**
 * @typedef {object} PriceBreakdown
 * @property {number} totalMicro integer micro-CNY
 * @property {{missMicro:number, hitMicro:number, outputMicro:number}} parts
 * @property {boolean} unknownModel
 * @property {PeriodKind} period
 * @property {string} pricedModel the table key actually used
 * @property {number} pricedAtMs
 * @property {{cacheHit:number, cacheMiss:number, output:number}} unitPrices CNY per 1M tokens
 */

/**
 * Replaceable pricing seam. `price` must be pure with respect to the inputs:
 * the same buckets + call time always produce the same breakdown, so a replay
 * of the session log reproduces the same money.
 *
 * @typedef {object} PricingStrategy
 * @property {(buckets:TokenBuckets, call:{model:string, provider:string, atMs:number}) => PriceBreakdown} price
 * @property {() => {tableVersion:string, currency:'CNY', models:string[], source:string|null}} describe
 */

/**
 * One balance reading. The seam exposes no credential, no URL and no upstream
 * response body — only an amount and when it was read.
 *
 * @typedef {object} BalanceReading
 * @property {number} amountCNY
 * @property {'CNY'} currency
 * @property {number} atMs
 * @property {string} source
 */

/**
 * Replaceable balance seam. `fetch` must reject with an Error carrying a
 * `code` from definition/protocol.js ERROR_CODES on any failure; the caller
 * keeps the previous reading and marks it stale.
 *
 * @typedef {object} BalanceProvider
 * @property {string} id
 * @property {string} label
 * @property {(signal:AbortSignal) => Promise<BalanceReading>} fetch
 */

/**
 * Alert seam, reserved. v1 wires `NullAlertSink`; a future alert is a new
 * provider file or a standalone View, never a change to the data layer.
 *
 * @typedef {object} AlertSink
 * @property {(e:{from:PeriodKind, to:PeriodKind, atMs:number}) => void} onPeakTransition
 * @property {(e:{staleSeconds:number, updatedAt:number|null}) => void} onBalanceStale
 * @property {(e:{turnCNY:number, sessionCNY:number}) => void} onBudgetThreshold
 */

/**
 * Client-side View seam. Each View is an independent module that renders into a
 * container it is handed and subscribes through `ctx`; views never know about
 * each other or about the Host.
 *
 * @typedef {object} ViewContext
 * @property {() => object} getSnapshot
 * @property {(fn:(vm:object)=>void) => () => void} subscribe
 * @property {() => Record<string, unknown>} getConfig
 * @property {(patch:Record<string, unknown>) => void} patchConfig
 * @property {(key:string, fallback:string) => string} locale
 */

/**
 * @typedef {object} ViewConfigSchema
 * @property {'object'} type
 * @property {Record<string, {type:string, title?:string, default?:unknown,
 *   enum?:readonly unknown[], minimum?:number, maximum?:number}>} properties
 */

/**
 * @typedef {object} View
 * @property {string} id
 * @property {string} label
 * @property {(container:HTMLElement, ctx:ViewContext) => void} mount
 * @property {() => void} unmount
 * @property {(viewModel:object) => void} update
 * @property {() => ViewConfigSchema} getConfigSchema
 * @property {() => string[]} supportedSlots
 */

/**
 * Runtime guards. They are cheap and they turn a broken replacement into a
 * readable startup error instead of a silent blank slot.
 */

const REQUIRED_PRICING = ['price', 'describe'];
const REQUIRED_PEAK = ['getCurrentPeriod', 'getNextTransition', 'getRemainingSeconds'];
const REQUIRED_BALANCE = ['fetch'];
const REQUIRED_VIEW = ['mount', 'unmount', 'update', 'getConfigSchema', 'supportedSlots'];

/**
 * @param {Record<string, unknown>} value
 * @param {readonly string[]} required
 * @param {string} what
 */
function assertMethods(value, required, what) {
  for (const name of required) {
    if (typeof value?.[name] !== 'function') {
      throw new TypeError(`${what} must implement ${name}()`);
    }
  }
}

/** @param {unknown} provider @returns {PricingStrategy} */
export function assertPricingStrategy(provider) {
  assertMethods(/** @type {Record<string, unknown>} */ (provider), REQUIRED_PRICING, 'PricingStrategy');
  return /** @type {PricingStrategy} */ (provider);
}

/** @param {unknown} provider @returns {PeakPeriodProvider} */
export function assertPeakPeriodProvider(provider) {
  assertMethods(/** @type {Record<string, unknown>} */ (provider), REQUIRED_PEAK, 'PeakPeriodProvider');
  return /** @type {PeakPeriodProvider} */ (provider);
}

/** @param {unknown} provider @returns {BalanceProvider} */
export function assertBalanceProvider(provider) {
  assertMethods(/** @type {Record<string, unknown>} */ (provider), REQUIRED_BALANCE, 'BalanceProvider');
  if (typeof /** @type {Record<string, unknown>} */ (provider).id !== 'string') {
    throw new TypeError('BalanceProvider must carry a string id');
  }
  return /** @type {BalanceProvider} */ (provider);
}

/** @param {unknown} view @returns {View} */
export function assertView(view) {
  assertMethods(/** @type {Record<string, unknown>} */ (view), REQUIRED_VIEW, 'View');
  return /** @type {View} */ (view);
}

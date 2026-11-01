/**
 * DeepSeek official CNY price table, version DS_CNY_2026_11.
 *
 * Source: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ (fetched 2026-11-01).
 * Unit: CNY per 1,000,000 tokens. Off-peak is exactly half of peak.
 *
 * | model            | cache hit  | cache miss | output     |
 * |------------------|------------|------------|------------|
 * | deepseek-flash   | 0.02 / 0.04| 1 / 2      | 4 / 8      |
 * | deepseek-v4-pro  | 0.15 / 0.30| 4.5 / 9    | 13.5 / 27  |
 *
 * The table is pure data: replacing prices means adding a new table module and
 * switching the registry entry — no algorithm changes.
 */

export const PRICE_TABLE_VERSION = 'DS_CNY_2026_11';

export const PRICE_TABLE = Object.freeze({
  version: PRICE_TABLE_VERSION,
  currency: 'CNY',
  unit: 'per_1M_tokens',
  source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
  fetchedAt: '2026-11-01',
  offPeakRatioOfPeak: 0.5,
  models: Object.freeze({
    'deepseek-flash': Object.freeze({
      peak: Object.freeze({ cacheHit: 0.04, cacheMiss: 2, output: 8 }),
    }),
    'deepseek-v4-pro': Object.freeze({
      peak: Object.freeze({ cacheHit: 0.3, cacheMiss: 9, output: 27 }),
    }),
  }),
  /**
   * Legacy names the provider may still report. They are served by the
   * `deepseek-flash` model and billed at the Flash price (per the pricing note).
   */
  aliases: Object.freeze({
    'deepseek-chat': 'deepseek-flash',
    'deepseek-reasoner': 'deepseek-flash',
    'deepseek-v4-flash': 'deepseek-flash',
    'deepseek-v4-flash-vision-exp': 'deepseek-flash',
    'deepseek-v3': 'deepseek-flash',
    'deepseek-v3.2': 'deepseek-flash',
  }),
});

/**
 * @param {typeof PRICE_TABLE} table
 * @param {string} model
 * @returns {{key:string, peak:{cacheHit:number,cacheMiss:number,output:number}, unknown:boolean}}
 */
export function resolveModelPrice(table, model) {
  const name = typeof model === 'string' ? model.trim() : '';
  const direct = table.models[name];
  if (direct !== undefined) return { key: name, peak: direct.peak, unknown: false };
  const alias = table.aliases[name];
  if (alias !== undefined && table.models[alias] !== undefined) {
    return { key: alias, peak: table.models[alias].peak, unknown: false };
  }
  // Unknown name: price it as Flash so the readout stays useful, but SAY SO.
  return { key: 'deepseek-flash', peak: table.models['deepseek-flash'].peak, unknown: true };
}

/**
 * Resolve the three unit prices actually charged for one call.
 *
 * @param {typeof PRICE_TABLE} table
 * @param {string} model
 * @param {'peak'|'idle'} kind
 * @returns {{key:string, unknown:boolean, ratio:number,
 *   cacheHit:number, cacheMiss:number, output:number}} CNY per 1M tokens
 */
export function pricesFor(table, model, kind) {
  const resolved = resolveModelPrice(table, model);
  const ratio = kind === 'peak' ? 1 : table.offPeakRatioOfPeak;
  return {
    key: resolved.key,
    unknown: resolved.unknown,
    ratio,
    cacheHit: resolved.peak.cacheHit * ratio,
    cacheMiss: resolved.peak.cacheMiss * ratio,
    output: resolved.peak.output * ratio,
  };
}

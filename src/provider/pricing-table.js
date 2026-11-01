/**
 * TablePricingStrategy — the v1 PricingStrategy.
 *
 * It settles ONE assistant call at a time and picks the peak/off-peak unit price
 * by asking the PeakPeriodProvider with that call's own timestamp — not with the
 * turn's end time. A turn that starts in peak and ends off-peak is therefore
 * billed correctly per step, which is what the official billing does.
 */

import { assertPricingStrategy } from '../definition/seam.js';
import { microCNYFrom } from '../definition/money.js';
import { PRICE_TABLE, PRICE_TABLE_VERSION, pricesFor } from '../definition/pricing-table-2026-11.js';

/**
 * @param {{table?: typeof PRICE_TABLE, peakProvider: import('../definition/seam.js').PeakPeriodProvider}} options
 * @returns {import('../definition/seam.js').PricingStrategy}
 */
export function createTablePricingStrategy({ table = PRICE_TABLE, peakProvider }) {
  if (peakProvider === undefined) throw new TypeError('TablePricingStrategy needs a PeakPeriodProvider');

  /**
   * @param {import('../definition/tokens.js').TokenBuckets} buckets
   * @param {{model:string, provider:string, atMs:number}} call
   * @returns {import('../definition/seam.js').PriceBreakdown}
   */
  const price = (buckets, call) => {
    const atMs = Number.isFinite(call.atMs) ? call.atMs : Date.now();
    const period = peakProvider.getCurrentPeriod(atMs);
    const prices = pricesFor(table, call.model, period.kind);

    const missMicro = microCNYFrom(buckets.cacheMiss, prices.cacheMiss);
    const hitMicro = microCNYFrom(buckets.cacheHit, prices.cacheHit);
    const outputMicro = microCNYFrom(buckets.output, prices.output);
    // DeepSeek charges no cache-write premium; if a future provider reports
    // cacheWrite we price it at the miss rate rather than dropping it silently.
    const writeMicro = microCNYFrom(buckets.cacheWrite, prices.cacheMiss);

    return {
      totalMicro: missMicro + hitMicro + outputMicro + writeMicro,
      parts: { missMicro, hitMicro, outputMicro: outputMicro + writeMicro },
      unknownModel: prices.unknown,
      period: period.kind,
      pricedModel: prices.key,
      pricedAtMs: atMs,
      unitPrices: { cacheHit: prices.cacheHit, cacheMiss: prices.cacheMiss, output: prices.output },
    };
  };

  const describe = () => ({
    tableVersion: PRICE_TABLE_VERSION,
    currency: /** @type {'CNY'} */ ('CNY'),
    models: Object.keys(table.models),
    source: table.source ?? null,
  });

  return assertPricingStrategy({ price, describe });
}

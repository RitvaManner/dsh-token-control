import assert from 'node:assert/strict';
import test from 'node:test';

import { createTablePricingStrategy } from '../src/provider/pricing-table.js';
import { normalizeUsage } from '../src/definition/tokens.js';
import { PRICE_TABLE } from '../src/definition/pricing-table-2026-11.js';

const bj = (y, m, d, hh = 0, mm = 0) => Date.UTC(y, m - 1, d, hh, mm) - 8 * 3600 * 1000;

/** A peak provider whose answer is decided by the hour we pass in. */
const stubPeak = (kind) => ({
  getCurrentPeriod: () => ({ kind, label: kind, ratioOfPeak: kind === 'peak' ? 1 : 0.5, calendarYear: 2026, estimated: false, nextTransitionAt: 0, remainingSeconds: 0, upcoming: 'idle' }),
  getNextTransition: () => ({ atMs: 0, to: 'idle' }),
  getRemainingSeconds: () => 0,
});

const buckets = (miss, hit, out) => normalizeUsage({ inputTokens: miss, cacheReadTokens: hit, outputTokens: out });

test('one million of each token at peak costs the official peak sum', () => {
  const pricing = createTablePricingStrategy({ peakProvider: stubPeak('peak') });
  const breakdown = pricing.price(buckets(1_000_000, 1_000_000, 1_000_000), { model: 'deepseek-flash', provider: 'deepseek', atMs: bj(2026, 11, 2, 10, 0) });
  // 2 (miss) + 0.04 (hit) + 8 (output) = 10.04 CNY
  assert.equal(breakdown.totalMicro, 10_040_000);
  assert.equal(breakdown.unknownModel, false);
  assert.equal(breakdown.period, 'peak');
});

test('off-peak is exactly half of peak', () => {
  const peak = createTablePricingStrategy({ peakProvider: stubPeak('peak') });
  const idle = createTablePricingStrategy({ peakProvider: stubPeak('idle') });
  const usage = buckets(500_000, 250_000, 100_000);
  const at = bj(2026, 11, 2, 10, 0);
  const peakCost = peak.price(usage, { model: 'deepseek-v4-pro', provider: 'deepseek', atMs: at }).totalMicro;
  const idleCost = idle.price(usage, { model: 'deepseek-v4-pro', provider: 'deepseek', atMs: at }).totalMicro;
  assert.equal(idleCost, Math.round(peakCost / 2));
});

test('the period is chosen from the call instant, not the settlement instant', () => {
  const peak = createTablePricingStrategy({ peakProvider: stubPeak('peak') });
  const idle = createTablePricingStrategy({ peakProvider: stubPeak('idle') });
  const usage = buckets(1000, 0, 100);
  assert.notEqual(
    peak.price(usage, { model: 'deepseek-flash', provider: 'deepseek', atMs: bj(2026, 11, 2, 10, 0) }).totalMicro,
    idle.price(usage, { model: 'deepseek-flash', provider: 'deepseek', atMs: bj(2026, 11, 2, 3, 0) }).totalMicro,
  );
});

test('legacy model names map to Flash without being flagged unknown', () => {
  const pricing = createTablePricingStrategy({ peakProvider: stubPeak('peak') });
  const breakdown = pricing.price(buckets(1000, 0, 0), { model: 'deepseek-chat', provider: 'deepseek', atMs: 0 });
  assert.equal(breakdown.pricedModel, 'deepseek-flash');
  assert.equal(breakdown.unknownModel, false);
});

test('an unknown model is priced as Flash but SAID so', () => {
  const pricing = createTablePricingStrategy({ peakProvider: stubPeak('peak') });
  const breakdown = pricing.price(buckets(1000, 0, 0), { model: 'some-future-model', provider: 'deepseek', atMs: 0 });
  assert.equal(breakdown.pricedModel, 'deepseek-flash');
  assert.equal(breakdown.unknownModel, true);
});

test('cache hits are charged the hit rate, not the miss rate', () => {
  const pricing = createTablePricingStrategy({ peakProvider: stubPeak('peak') });
  const hitOnly = pricing.price(buckets(0, 1000, 0), { model: 'deepseek-flash', provider: 'deepseek', atMs: 0 });
  const missOnly = pricing.price(buckets(1000, 0, 0), { model: 'deepseek-flash', provider: 'deepseek', atMs: 0 });
  assert.ok(hitOnly.totalMicro > 0);
  assert.ok(missOnly.totalMicro > hitOnly.totalMicro * 40); // 2 vs 0.04 CNY per 1M
});

test('an empty usage costs nothing and never throws', () => {
  const pricing = createTablePricingStrategy({ peakProvider: stubPeak('peak') });
  const breakdown = pricing.price(normalizeUsage(undefined), { model: 'deepseek-flash', provider: 'deepseek', atMs: 0 });
  assert.equal(breakdown.totalMicro, 0);
});

test('describe exposes the table version and CNY without secrets', () => {
  const pricing = createTablePricingStrategy({ peakProvider: stubPeak('peak') });
  const described = pricing.describe();
  assert.equal(described.currency, 'CNY');
  assert.equal(described.tableVersion, PRICE_TABLE.version);
  assert.deepEqual(described.models.sort(), ['deepseek-flash', 'deepseek-v4-pro']);
});

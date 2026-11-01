import assert from 'node:assert/strict';
import test from 'node:test';

import { applyViewModelPatch, createEmptyViewModel } from '../src/definition/view-model.js';
import { normalizeUsage } from '../src/definition/tokens.js';
import { createLedger } from '../src/consumer/ledger.js';
import { createViewModelBuilder } from '../src/consumer/view-model-builder.js';
import { createCalibrator } from '../src/provider/calibrator.js';
import { createTablePricingStrategy } from '../src/provider/pricing-table.js';

const at = Date.UTC(2026, 10, 2, 2, 0); // 2026-11-02 10:00 Beijing, a peak window

const peakProvider = {
  getCurrentPeriod: () => ({
    kind: 'peak',
    label: '高峰',
    ratioOfPeak: 1,
    calendarYear: 2026,
    estimated: false,
    nextTransitionAt: at + 600_000,
    remainingSeconds: 600,
    upcoming: 'idle',
  }),
  getNextTransition: () => ({ atMs: at + 600_000, to: 'idle' }),
  getRemainingSeconds: () => 600,
};

const balanceState = {
  snapshot: () => ({ state: 'ok', amountCNY: 98.76, updatedAt: at - 60_000, staleSeconds: 60, source: 'deepseek-api', error: null }),
};

function makeBuilder() {
  const pricing = createTablePricingStrategy({ peakProvider });
  const ledger = createLedger({ pricing, now: () => at });
  const builder = createViewModelBuilder({
    ledger,
    peakProvider,
    balanceState,
    calibrator: createCalibrator(),
    pricing,
    now: () => at,
  });
  return { ledger, builder, pricing };
}

test('inputTokens is the cache-MISS portion, never the prompt total', () => {
  const usage = normalizeUsage({ inputTokens: 200, cacheReadTokens: 800, outputTokens: 50 });
  assert.equal(usage.cacheMiss, 200);
  assert.equal(usage.cacheHit, 800);
  assert.equal(usage.inputTotal, 1000);
  assert.equal(usage.total, 1050);
});

test('a settled turn reports split tokens and a settled cost', () => {
  const { ledger, builder } = makeBuilder();
  ledger.ingestEvent('s1', { type: 'turn/start', time: at, data: { turn: 1 } });
  ledger.ingestEvent('s1', {
    type: 'assistant/message',
    time: at + 1000,
    data: {
      turn: 1,
      step: 1,
      usage: { inputTokens: 200, cacheReadTokens: 800, outputTokens: 50 },
      message: { source: { provider: 'deepseek-account', model: 'deepseek-flash' } },
    },
  });
  ledger.ingestEvent('s1', { type: 'turn/end', time: at + 2000, data: { turn: 1, reason: { kind: 'completed' } } });

  const vm = builder.build('s1');
  assert.equal(vm.turn.tokens.input, 1000);
  assert.equal(vm.turn.tokens.cacheHit, 800);
  assert.equal(vm.turn.tokens.cacheMiss, 200);
  assert.equal(vm.turn.tokens.output, 50);
  assert.equal(vm.turn.tokens.total, 1050);
  assert.equal(vm.turn.state, 'settled');
  assert.equal(vm.turn.cost.settled, true);
  // 200*2 + 800*0.04 + 50*8 micro-CNY = 400 + 32 + 400 = 832
  assert.equal(Math.round(vm.turn.cost.cny * 1e6), 832);
  assert.deepEqual(vm.turn.models, ['deepseek-flash']);
});

test('the wire object carries exactly the documented sections', () => {
  const { builder } = makeBuilder();
  const vm = builder.build('s2');
  assert.deepEqual(Object.keys(vm).sort(), ['balance', 'meta', 'period', 'schemaVersion', 'session', 'sessionId', 'turn']);
  const serialized = JSON.stringify(vm);
  for (const forbidden of ['apiKey', 'authorization', 'DEEPSEEK_API_KEY', 'events', 'stream']) {
    assert.equal(serialized.includes(forbidden), false, `ViewModel must not contain "${forbidden}"`);
  }
});

test('a streamed call shows an explicitly estimated output before usage lands', () => {
  const { ledger, builder } = makeBuilder();
  ledger.ingestEvent('s3', { type: 'turn/start', time: at, data: { turn: 1 } });
  ledger.ingestStream('s3', { type: 'start', turn: 1, step: 1 });
  ledger.ingestStream('s3', { type: 'chunk', chunk: { type: 'text-delta', text: 'x'.repeat(44) } });
  const live = builder.build('s3');
  assert.equal(live.turn.tokens.estimated, true);
  assert.equal(live.turn.tokens.output, 20);
  assert.equal(live.turn.cost.settled, false);

  ledger.ingestStream('s3', { type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 10, cacheReadTokens: 0, outputTokens: 7 } } });
  const withUsage = builder.build('s3');
  assert.equal(withUsage.turn.tokens.estimated, false);
  assert.equal(withUsage.turn.tokens.output, 7);
});

test('an unknown model is flagged in the cost basis', () => {
  const { ledger, builder } = makeBuilder();
  ledger.ingestEvent('s4', { type: 'turn/start', time: at, data: { turn: 1 } });
  ledger.ingestEvent('s4', {
    type: 'assistant/message',
    time: at,
    data: { turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 1 }, message: { source: { provider: 'x', model: 'mystery' } } },
  });
  assert.equal(builder.build('s4').turn.cost.basis, 'unknown-model');
});

test('session totals accumulate across turns while the turn view resets', () => {
  const { ledger, builder } = makeBuilder();
  const message = (time) => ({
    type: 'assistant/message',
    time,
    data: { turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 10 }, message: { source: { provider: 'deepseek', model: 'deepseek-flash' } } },
  });
  ledger.ingestEvent('s5', { type: 'turn/start', time: at, data: { turn: 1 } });
  ledger.ingestEvent('s5', message(at));
  ledger.ingestEvent('s5', { type: 'turn/end', time: at, data: { turn: 1, reason: { kind: 'completed' } } });
  ledger.ingestEvent('s5', { type: 'turn/start', time: at, data: { turn: 2 } });
  ledger.ingestEvent('s5', message(at));
  const vm = builder.build('s5');
  assert.equal(vm.turn.tokens.total, 110);
  assert.equal(vm.session.tokens.total, 220);
});

test('an unknown field on a newer Host is preserved and never throws', () => {
  const base = createEmptyViewModel('s6', at);
  const patched = applyViewModelPatch(base, { futureSection: { value: 1 }, turn: { index: 3 } });
  assert.equal(patched.futureSection.value, 1);
  assert.equal(patched.turn.index, 3);
  assert.equal(patched.turn.tokens.total, 0);
  assert.equal(applyViewModelPatch(base, null), base);
});

test('the ViewModel is JSON-serializable with no cycles', () => {
  const { builder } = makeBuilder();
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(builder.build('s7'))));
});

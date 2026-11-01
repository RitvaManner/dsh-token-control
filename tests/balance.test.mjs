import assert from 'node:assert/strict';
import test from 'node:test';

import { createBalanceState } from '../src/provider/balance-state.js';
import { createDeepSeekBalanceProvider, readCnyBalance } from '../src/provider/balance-deepseek.js';

const okPayload = {
  is_available: true,
  balance_infos: [
    { currency: 'USD', total_balance: '1.00', granted_balance: '0.00', topped_up_balance: '1.00' },
    { currency: 'CNY', total_balance: '98.76', granted_balance: '8.00', topped_up_balance: '90.76' },
  ],
};

test('the CNY wallet is read from the documented payload', () => {
  assert.equal(readCnyBalance(okPayload), 98.76);
});

test('a payload without a CNY wallet is a typed bad-payload error', () => {
  assert.throws(() => readCnyBalance({ balance_infos: [{ currency: 'USD', total_balance: '1' }] }), (error) => error.code === 'bad-payload');
  assert.throws(() => readCnyBalance(null), (error) => error.code === 'bad-payload');
  assert.throws(() => readCnyBalance({ balance_infos: [{ currency: 'CNY', total_balance: 'abc' }] }), (error) => error.code === 'bad-payload');
});

test('a missing credential fails before any request is made', async () => {
  let called = false;
  const provider = createDeepSeekBalanceProvider({
    credentials: { resolve: async () => undefined },
    fetchImpl: async () => {
      called = true;
      return { ok: true, json: async () => okPayload };
    },
  });
  await assert.rejects(provider.fetch(new AbortController().signal), (error) => error.code === 'no-credential');
  assert.equal(called, false, 'no network call without a credential');
});

test('an HTTP rejection is mapped to a typed error and never carries the body', async () => {
  const provider = createDeepSeekBalanceProvider({
    credentials: { resolve: async () => ({ value: 'sk-test' }) },
    fetchImpl: async () => ({ ok: false, status: 401, arrayBuffer: async () => new ArrayBuffer(0) }),
  });
  await assert.rejects(provider.fetch(new AbortController().signal), (error) => {
    assert.equal(error.code, 'http-401');
    assert.equal(String(error.message).includes('sk-test'), false);
    return true;
  });
});

test('a successful reading reports CNY and the source, never the key', async () => {
  let seenAuth = null;
  const provider = createDeepSeekBalanceProvider({
    credentials: { resolve: async () => ({ value: 'sk-test' }) },
    fetchImpl: async (url, init) => {
      seenAuth = init.headers.authorization;
      assert.equal(url, 'https://api.deepseek.com/user/balance');
      return { ok: true, status: 200, json: async () => okPayload };
    },
    now: () => 1234,
  });
  const reading = await provider.fetch(new AbortController().signal);
  assert.equal(reading.amountCNY, 98.76);
  assert.equal(reading.currency, 'CNY');
  assert.equal(reading.atMs, 1234);
  assert.equal(seenAuth, 'Bearer sk-test');
  assert.equal(JSON.stringify(reading).includes('sk-test'), false);
});

test('a failed refresh keeps the previous reading and marks it stale', async () => {
  let now = 1_000_000;
  let mode = 'ok';
  const provider = {
    id: 'fake',
    label: 'fake',
    fetch: async () => {
      if (mode === 'ok') return { amountCNY: 50, currency: 'CNY', atMs: now, source: 'fake' };
      throw Object.assign(new Error('boom'), { code: 'network' });
    },
  };
  const state = createBalanceState({ provider, now: () => now });

  const first = await state.refresh();
  assert.equal(first.state, 'ok');
  assert.equal(first.amountCNY, 50);

  mode = 'fail';
  now += 10 * 60 * 1000;
  const second = await state.refresh();
  assert.equal(second.amountCNY, 50, 'the last reading survives a failure');
  assert.equal(second.state, 'stale');
  assert.equal(second.error.code, 'network');
  assert.equal(second.updatedAt, 1_000_000);
});

test('a reading older than two minutes is stale even without an error', async () => {
  let now = 1_000_000;
  const provider = { id: 'fake', label: 'fake', fetch: async () => ({ amountCNY: 5, currency: 'CNY', atMs: now, source: 'fake' }) };
  const state = createBalanceState({ provider, now: () => now });
  await state.refresh();
  now += 121_000;
  const snapshot = state.snapshot();
  assert.equal(snapshot.state, 'stale');
  assert.equal(snapshot.staleSeconds, 121);
});

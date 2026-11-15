import assert from 'node:assert/strict';
import test from 'node:test';

import { ACCOUNT_SOURCE, createAccountBalanceProvider, sumAccountCny } from '../src/provider/balance-account.js';
import { createFallbackBalanceProvider } from '../src/provider/balance-fallback.js';

const readyOutcome = {
  status: 'ready',
  value: [
    { currency: 'USD', balance: '1.00' },
    { currency: 'CNY', balance: '8.10' },
  ],
  bonusWallets: [{ currency: 'CNY', balance: '1.55' }],
};

const client = () => ({ version: '1.2.3', locale: 'zh-CN', timezoneOffsetSeconds: 28_800 });

test('the CNY recharge and bonus wallets are summed and rounded', () => {
  // 8.10 + 1.55 is 9.649999999999999 as binary floats.
  assert.equal(sumAccountCny(readyOutcome), 9.65);
});

test('non-CNY wallets are ignored', () => {
  assert.equal(sumAccountCny({ status: 'ready', value: [{ currency: 'CNY', balance: '2.5' }], bonusWallets: [{ currency: 'USD', balance: '99' }] }), 2.5);
});

test('a signed-out account is a typed no-credential error', () => {
  for (const outcome of [null, undefined]) {
    assert.throws(() => sumAccountCny(outcome), (error) => error.code === 'no-credential');
  }
});

test('a non-ready outcome and a malformed outcome are typed errors', () => {
  assert.throws(() => sumAccountCny({ status: 'failed' }), (error) => error.code === 'network');
  assert.throws(() => sumAccountCny('nope'), (error) => error.code === 'bad-payload');
  assert.throws(() => sumAccountCny({ status: 'ready', value: [], bonusWallets: [] }), (error) => error.code === 'bad-payload');
  assert.throws(() => sumAccountCny({ status: 'ready', value: [{ currency: 'CNY', balance: 'abc' }] }), (error) => error.code === 'bad-payload');
  assert.throws(() => sumAccountCny({ status: 'ready', value: 'not-a-list' }), (error) => error.code === 'bad-payload');
});

test('the provider asks the account service with the client metadata and reports its source', async () => {
  const seen = [];
  const provider = createAccountBalanceProvider({
    getAccount: () => ({
      getBalance: async (received) => {
        seen.push(received);
        return readyOutcome;
      },
    }),
    client,
    now: () => 4242,
  });

  const reading = await provider.fetch(new AbortController().signal);
  assert.equal(reading.amountCNY, 9.65);
  assert.equal(reading.currency, 'CNY');
  assert.equal(reading.atMs, 4242);
  assert.equal(reading.source, ACCOUNT_SOURCE);
  assert.deepEqual(seen, [client()]);
});

test('a profile without the account service degrades to no-credential', async () => {
  const provider = createAccountBalanceProvider({ getAccount: () => undefined, client });
  await assert.rejects(provider.fetch(new AbortController().signal), (error) => error.code === 'no-credential');
});

test('a throwing account service is a typed network error and never leaks its message', async () => {
  const provider = createAccountBalanceProvider({
    getAccount: () => ({
      getBalance: async () => {
        throw new Error('platform token expired for user 12345');
      },
    }),
    client,
  });
  await assert.rejects(provider.fetch(new AbortController().signal), (error) => {
    assert.equal(error.code, 'network');
    assert.equal(String(error.message).includes('12345'), false);
    return true;
  });
});

test('the fallback provider answers from the primary when it can', async () => {
  let fallbackCalls = 0;
  const provider = createFallbackBalanceProvider({
    primary: { id: 'deepseek', label: 'DeepSeek 余额', fetch: async () => ({ amountCNY: 12, currency: 'CNY', atMs: 1, source: 'deepseek-api' }) },
    fallback: {
      id: 'deepseek-account',
      label: 'DeepSeek 余额',
      fetch: async () => {
        fallbackCalls += 1;
        return { amountCNY: 99, currency: 'CNY', atMs: 2, source: 'deepseek-account' };
      },
    },
  });

  const reading = await provider.fetch(new AbortController().signal);
  assert.equal(reading.amountCNY, 12);
  assert.equal(reading.source, 'deepseek-api');
  assert.equal(fallbackCalls, 0);
  assert.equal(provider.id, 'deepseek');
});

test('the fallback provider asks the account source only when no credential exists', async () => {
  const provider = createFallbackBalanceProvider({
    primary: {
      id: 'deepseek',
      label: 'DeepSeek 余额',
      fetch: async () => {
        throw Object.assign(new Error('no key'), { code: 'no-credential' });
      },
    },
    fallback: { id: 'deepseek-account', label: 'DeepSeek 余额', fetch: async () => ({ amountCNY: 7.5, currency: 'CNY', atMs: 3, source: 'deepseek-account' }) },
  });

  const reading = await provider.fetch(new AbortController().signal);
  assert.equal(reading.amountCNY, 7.5);
  assert.equal(reading.source, 'deepseek-account');
});

test('the fallback provider rethrows a real failure instead of switching source', async () => {
  let fallbackCalls = 0;
  const provider = createFallbackBalanceProvider({
    primary: {
      id: 'deepseek',
      label: 'DeepSeek 余额',
      fetch: async () => {
        throw Object.assign(new Error('rejected'), { code: 'http-401' });
      },
    },
    fallback: {
      id: 'deepseek-account',
      label: 'DeepSeek 余额',
      fetch: async () => {
        fallbackCalls += 1;
        return { amountCNY: 1, currency: 'CNY', atMs: 4, source: 'deepseek-account' };
      },
    },
  });

  await assert.rejects(provider.fetch(new AbortController().signal), (error) => error.code === 'http-401');
  assert.equal(fallbackCalls, 0, 'a configured key never silently changes source');
});

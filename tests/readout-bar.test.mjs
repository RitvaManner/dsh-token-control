import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const VIEW_FILE = join(dirname(fileURLToPath(import.meta.url)), '../src/client/views/readout-bar.js');
const SOURCE = readFileSync(VIEW_FILE, 'utf8');

/**
 * The smallest DOM the ReadoutBar touches. Enough to prove the View renders
 * real text for a real ViewModel, without pulling a browser dependency in.
 */
function createDom() {
  /** @param {string} tag */
  function element(tag) {
    return {
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      hidden: false,
      children: [],
      parentNode: null,
      attributes: {},
      set innerHTML(value) {
        if (value === '') this.children = [];
      },
      get innerHTML() {
        return '';
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
      },
      removeChild(child) {
        this.children = this.children.filter((entry) => entry !== child);
        child.parentNode = null;
      },
    };
  }

  const document = {
    createElement: element,
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) };
    },
    head: element('head'),
  };
  return { document };
}

/** @param {any} node @returns {string} */
function textOf(node) {
  if (node === null || node === undefined) return '';
  if (node.nodeType === 3) return node.textContent;
  const own = node.textContent ?? '';
  return own + (node.children ?? []).map(textOf).join(' ');
}

function loadView() {
  const dom = createDom();
  /** @type {any} */
  let factory = null;
  const sandbox = {
    window: {
      __DSH_TOKEN_CONTROL_VIEWS__: {
        register(id, value) {
          factory = value;
        },
      },
    },
    document: dom.document,
    console,
    Date,
    Math,
    Number,
    String,
    isFinite,
    setInterval: () => 1,
    clearInterval: () => {},
  };
  vm.runInNewContext(SOURCE, sandbox, { filename: 'readout-bar.js' });
  assert.equal(typeof factory, 'function', 'the View must self-register through the registry hook');
  return { view: factory({ h: () => null, React: {}, locale: (key, fallback) => fallback }), dom };
}

const baseViewModel = () => ({
  schemaVersion: 1,
  sessionId: 's1',
  turn: {
    index: 2,
    state: 'settled',
    live: false,
    tokens: { input: 1000, output: 50, cacheHit: 800, cacheMiss: 200, cacheWrite: 0, reasoning: 0, total: 1050, estimated: false },
    cost: { cny: 0.00094, settled: true, basis: 'table', breakdown: null },
    models: ['deepseek-flash'],
  },
  session: { tokens: { total: 1050 }, costCNY: 0.00094 },
  balance: { state: 'ok', cny: 2.17, updatedAt: 1, staleSeconds: 30, source: 'deepseek-api', error: null },
  period: {
    kind: 'idle',
    label: 'off-peak',
    ratioOfPeak: 0.5,
    calendarYear: 2026,
    estimated: false,
    nextTransitionAt: Date.now() + 600_000,
    remainingSeconds: 600,
    remind: false,
    upcoming: 'peak',
  },
  meta: { hostTime: Date.now(), revision: 3, currency: 'CNY' },
});

test('the readout renders the split tokens, the money, the balance and the window', () => {
  const { view, dom } = loadView();
  const container = dom.document.createElement('div');
  let snapshot = baseViewModel();
  view.mount(container, {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    getConfig: () => ({ decimals: 4, showBalance: true, showCacheSplit: true, showCountdown: true }),
    patchConfig: () => {},
    locale: (key, fallback) => fallback,
  });

  view.update(snapshot);
  const text = textOf(container);
  assert.match(text, /1,050/, 'total tokens');
  assert.match(text, /0\.0009/, 'turn cost');
  assert.match(text, /in 1,000 \/ out 50/, 'input total and output');
  assert.match(text, /cache hit 800 \/ cache miss 200/, 'cache split');
  assert.match(text, /balance ¥2\.17/, 'balance');
  assert.match(text, /Off-peak/, 'current window');
  assert.match(text, /until peak/, 'countdown target');
  view.unmount();
});

test('a stale balance is labelled, not hidden', () => {
  const { view, dom } = loadView();
  const container = dom.document.createElement('div');
  const snapshot = baseViewModel();
  snapshot.balance = { state: 'stale', cny: 2.17, updatedAt: 1, staleSeconds: 480, source: 'deepseek-api', error: { code: 'network' } };
  view.mount(container, {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    getConfig: () => ({}),
    patchConfig: () => {},
    locale: (key, fallback) => fallback,
  });
  view.update(snapshot);
  const text = textOf(container);
  assert.match(text, /stale 8 min ago/, 'staleness and age');
  view.unmount();
});

test('a missing API key is stated instead of showing a fake zero', () => {
  const { view, dom } = loadView();
  const container = dom.document.createElement('div');
  const snapshot = baseViewModel();
  snapshot.balance = { state: 'unconfigured', cny: null, updatedAt: null, staleSeconds: null, source: null, error: null };
  view.mount(container, {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    getConfig: () => ({}),
    patchConfig: () => {},
    locale: (key, fallback) => fallback,
  });
  view.update(snapshot);
  assert.match(textOf(container), /no API key/);
  view.unmount();
});

test('an estimating call is marked and never claims exactness', () => {
  const { view, dom } = loadView();
  const container = dom.document.createElement('div');
  const snapshot = baseViewModel();
  snapshot.turn.state = 'streaming';
  snapshot.turn.tokens = { input: 0, output: 20, cacheHit: 0, cacheMiss: 0, cacheWrite: 0, reasoning: 0, total: 20, estimated: true };
  snapshot.turn.cost = { cny: 0.00008, settled: false, basis: 'table', breakdown: null };
  view.mount(container, {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    getConfig: () => ({}),
    patchConfig: () => {},
    locale: (key, fallback) => fallback,
  });
  view.update(snapshot);
  const text = textOf(container);
  assert.match(text, /≈/, 'estimate marker');
  assert.match(text, /estimating/);
  view.unmount();
});

test('unmount leaves no nodes behind', () => {
  const { view, dom } = loadView();
  const container = dom.document.createElement('div');
  view.mount(container, {
    getSnapshot: () => baseViewModel(),
    subscribe: () => () => {},
    getConfig: () => ({}),
    patchConfig: () => {},
    locale: (key, fallback) => fallback,
  });
  assert.ok(container.children.length > 0);
  view.unmount();
  assert.equal(container.children.length, 0);
});

test('the declared schema and slots are the documented ones', () => {
  const { view } = loadView();
  const schema = view.getConfigSchema();
  assert.deepEqual(Object.keys(schema.properties).sort(), ['compact', 'decimals', 'showBalance', 'showCacheSplit', 'showCountdown']);
  const slots = view.supportedSlots();
  assert.ok(slots.includes('conversation.input.dock'));
  assert.ok(slots.includes('conversation.composer.dock'));
});

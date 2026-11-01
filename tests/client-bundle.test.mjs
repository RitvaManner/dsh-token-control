import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const BUNDLE = join(dirname(fileURLToPath(import.meta.url)), '../src/client/client.js');
const SOURCE = readFileSync(BUNDLE, 'utf8');

/**
 * Boot the real Client bundle in a sandbox that behaves like the Harness module
 * loader: `__ModuleLoader__.load` captures the factory, `require('react')`
 * returns a stand-in, and `ctx` is a recording fake.
 *
 * This reproduces the browser's activation path (including the generated View
 * inlining) so a "view not registered" regression fails here instead of in the
 * user's page.
 */
function boot() {
  /** @type {any} */
  let registration = null;
  const slots = [];
  const effects = [];

  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (value) => [value, () => {}],
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
  };

  const window = {
    __DSH_TOKEN_CONTROL_VIEWS__: undefined,
    location: { href: 'http://127.0.0.1:53660/' },
  };

  const responses = {
    '/api/dsh-token-control/v1/view-config': {
      protocolVersion: 1,
      schemaVersion: 1,
      views: [{ id: 'readout-bar', enabled: true, slot: 'conversation.input.dock', order: 25, config: {} }],
      knownSlots: ['conversation.input.dock', 'conversation.composer.dock', 'conversation.composer.bar'],
      knownViews: [{ id: 'readout-bar', label: '读数带' }],
      warnings: [],
    },
  };

  const sandbox = {
    window,
    document: {
      createElement: () => ({ appendChild: () => {}, setAttribute: () => {}, style: {} }),
      createTextNode: (text) => ({ textContent: String(text) }),
      head: { appendChild: () => {} },
    },
    fetch: async (url) => {
      const path = String(url).split('?')[0];
      const body = Object.prototype.hasOwnProperty.call(responses, path) ? responses[path] : null;
      return {
        ok: body !== null,
        status: body === null ? 404 : 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    },
    console: { info: () => {}, warn: () => {}, error: (...args) => sandbox.__errors.push(args) },
    __errors: [],
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    AbortController,
    TextDecoder,
    URL,
    Date,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Error,
    Promise,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
  };

  sandbox.window.__ModuleLoader__ = {
    load(entry) {
      registration = entry;
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'client.js' });

  assert.ok(registration !== null, 'the bundle must register a module factory');
  assert.equal(registration.id, 'dsh-token-control');

  const plugin = registration.factory((specifier) => {
    if (specifier === 'react') return react;
    throw new Error(`unexpected require(${specifier})`);
  });

  const ctx = {
    get: () => undefined,
    on: () => () => {},
    effect: (callback, label) => {
      const dispose = callback();
      effects.push({ label, dispose });
      return () => {};
    },
    slots: {
      inject(key, callback) {
        slots.push(key);
        callback();
        return () => {};
      },
      register(options, component) {
        slots.push({ ...options, component });
        return () => {};
      },
    },
  };

  return { plugin, ctx, slots, effects, sandbox, window };
}

test('the bundle registers a plugin that declares the slots service', () => {
  const { plugin } = boot();
  assert.equal(typeof plugin.apply, 'function');
  // `.join` crosses the vm realm boundary; comparing the array objects directly
  // would compare prototypes from two different realms.
  assert.equal(plugin.inject.join(','), 'slots');
});

test('applying the plugin registers the settings page and the View slot', async () => {
  const { plugin, ctx, slots, sandbox } = boot();
  plugin.apply(ctx);
  await new Promise((resolve) => setImmediate(resolve));

  const injected = slots.filter((entry) => typeof entry === 'string');
  assert.deepEqual(injected.sort(), ['conversation.input.dock', 'settings.section']);

  const registered = slots.filter((entry) => typeof entry === 'object');
  const ids = registered.map((entry) => entry.id).sort();
  assert.deepEqual(ids, ['dsh-token-control', 'token-control:readout-bar']);
  assert.equal(registered.find((entry) => entry.id === 'token-control:readout-bar').order, 25);
  assert.deepEqual(sandbox.__errors, [], 'activation must not log errors');
});

test('the inlined View is available to the registry at apply time', () => {
  const { plugin, ctx, sandbox } = boot();
  plugin.apply(ctx);
  // The build inlines every View; the temporary handshake global must be gone
  // once apply returns, so no other activation can be clobbered.
  assert.equal(sandbox.window.__DSH_TOKEN_CONTROL_VIEWS__, undefined);
});

test('a second activation still registers the View', async () => {
  const first = boot();
  first.plugin.apply(first.ctx);
  const second = boot();
  second.plugin.apply(second.ctx);
  await new Promise((resolve) => setImmediate(resolve));

  for (const instance of [first, second]) {
    const ids = instance.slots
      .filter((entry) => typeof entry === 'object')
      .map((entry) => entry.id);
    assert.ok(ids.includes('token-control:readout-bar'), 'every activation registers the View');
  }
});

test('a missing Host config falls back to the built-in layout instead of rendering nothing', async () => {
  const { plugin, ctx, slots, sandbox } = boot();
  // Make every request fail, as an unreachable Host would.
  sandbox.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => null,
    text: async () => '',
  });
  plugin.apply(ctx);
  await new Promise((resolve) => setImmediate(resolve));

  const registered = slots.filter((entry) => typeof entry === 'object').map((entry) => entry.id);
  assert.ok(registered.includes('token-control:readout-bar'), 'fallback layout still mounts the readout');
  assert.ok(sandbox.__errors.length > 0, 'the failure is reported, not swallowed');
});

import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { PROTOCOL_VERSION, ROUTE_PREFIX, ROUTES } from '../src/definition/protocol.js';
import { normalizeViewConfig } from '../src/consumer/view-config.js';
import { runChecks } from '../scripts/check.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('the Seam direction and the wire mirrors pass the static check', () => {
  // In-process so it also runs where the sandbox forbids child processes.
  const { failures } = runChecks({ syntaxCheck: false });
  assert.deepEqual(failures, [], `architecture violations:\n${failures.join('\n')}`);
  assert.ok(join(ROOT, 'src').length > 0);
});

test('the wire constants are stable', () => {
  assert.equal(PROTOCOL_VERSION, 1);
  assert.equal(ROUTE_PREFIX, '/api/dsh-token-control/v1');
  assert.equal(ROUTES.snapshot, `${ROUTE_PREFIX}/snapshot`);
  assert.equal(ROUTES.stream, `${ROUTE_PREFIX}/stream`);
  assert.equal(ROUTES.viewConfig, `${ROUTE_PREFIX}/view-config`);
});

test('a config from a newer build degrades instead of breaking', () => {
  const { config, warnings } = normalizeViewConfig(
    {
      schemaVersion: 99,
      views: [
        { id: 'readout-bar', enabled: true, slot: 'conversation.input.dock', config: { compact: true, futureFlag: 'x', nested: { a: 1 } } },
        { id: 'not-yet-installed', enabled: true, slot: 'shell.overlay' },
        { id: 'readout-bar', enabled: false },
        'garbage',
      ],
    },
    { knownViewIds: ['readout-bar'], knownSlots: ['conversation.input.dock'] },
  );
  assert.equal(config.views.length, 1);
  assert.equal(config.views[0].config.compact, true);
  assert.equal(config.views[0].config.futureFlag, 'x');
  assert.equal(config.views[0].config.nested, undefined, 'nested values are dropped');
  assert.ok(warnings.some((warning) => warning.includes('not-yet-installed')));
  assert.ok(warnings.some((warning) => warning.includes('duplicate')));
});

test('an unknown slot falls back to the documented default', () => {
  const { config, warnings } = normalizeViewConfig(
    { schemaVersion: 1, views: [{ id: 'readout-bar', enabled: true, slot: 'no.such.slot' }] },
    { knownViewIds: ['readout-bar'], knownSlots: ['conversation.input.dock'] },
  );
  assert.equal(config.views[0].slot, 'conversation.input.dock');
  assert.ok(warnings.length > 0);
});

test('missing or malformed documents fall back to the built-in default', () => {
  for (const raw of [undefined, null, {}, { views: 'nope' }]) {
    const { config } = normalizeViewConfig(raw, { knownViewIds: ['readout-bar'] });
    assert.equal(config.views[0].id, 'readout-bar');
    assert.equal(config.views[0].enabled, true);
    assert.equal(config.views[0].slot, 'conversation.input.dock');
  }
});

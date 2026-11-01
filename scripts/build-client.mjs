#!/usr/bin/env node
/**
 * Build the Client bundle by inlining every View listed in
 * `src/client/views/index.json` into `src/client/client.js`.
 *
 * Why a build step at all: the Harness Client module loader runs a package's
 * `./client` export as a classic script, so a bundle cannot `import` a sibling
 * file, and the page offers no reliable way to pull one in later (a dynamic
 * `<script>` depends on page policy, a page-global handshake depends on load
 * order, and a second bundle would need its own graph entry). Inlining at build
 * time keeps "one new file per View" while removing every runtime moving part.
 *
 * Usage:
 *   node scripts/build-client.mjs          # write the bundle
 *   node scripts/build-client.mjs --check  # exit 1 when the bundle is stale
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = join(ROOT, 'src/client/core.js');
const OUTPUT = join(ROOT, 'src/client/client.js');
const VIEWS = join(ROOT, 'src/client/views');
const MARKER = '/* __TOKEN_CONTROL_VIEWS__ */';

/** @param {string} text @param {number} spaces */
function indent(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : pad + line))
    .join('\n');
}

/**
 * @returns {{source: string, views: string[]}}
 */
export function buildClientSource() {
  const manifest = JSON.parse(readFileSync(join(VIEWS, 'index.json'), 'utf8'));
  const views = Array.isArray(manifest.views) ? manifest.views : [];
  const blocks = [];
  const ids = [];

  for (const entry of views) {
    if (typeof entry?.id !== 'string' || typeof entry?.script !== 'string') continue;
    ids.push(entry.id);
    const source = readFileSync(join(VIEWS, entry.script), 'utf8').trimEnd();
    blocks.push(`/* ---- view: ${entry.id} (${entry.script}) ---- */\n${source}`);
  }

  const injected = [
    '{',
    '  // Views register through a hook that exists only for the duration of this',
    '  // synchronous block, so two activations can never clobber each other.',
    '  const host = {',
    '    register(id, factory) {',
    '      if (registry.register(id, factory)) bumpLayout();',
    '    },',
    '  };',
    '  const previousHost = window.__DSH_TOKEN_CONTROL_VIEWS__;',
    '  window.__DSH_TOKEN_CONTROL_VIEWS__ = host;',
    '  try {',
    indent(blocks.join('\n\n'), 4),
    '  } finally {',
    '    if (window.__DSH_TOKEN_CONTROL_VIEWS__ === host) {',
    '      if (previousHost === undefined) delete window.__DSH_TOKEN_CONTROL_VIEWS__;',
    '      else window.__DSH_TOKEN_CONTROL_VIEWS__ = previousHost;',
    '    }',
    '  }',
    '}',
  ].join('\n');

  const core = readFileSync(CORE, 'utf8');
  if (!core.includes(MARKER)) {
    throw new Error(`build-client: ${MARKER} is missing from src/client/core.js`);
  }

  const header = [
    '/*',
    ' * GENERATED FILE — edit src/client/core.js and src/client/views/*.js instead,',
    ' * then run: node scripts/build-client.mjs',
    ' */',
  ].join('\n');

  return {
    source: `${header}\n${core.replace(MARKER, () => injected)}`,
    views: ids,
  };
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]).endsWith('build-client.mjs');

if (invokedDirectly) {
  const { source, views } = buildClientSource();
  const checkOnly = process.argv.includes('--check');
  if (checkOnly) {
    const current = readFileSync(OUTPUT, 'utf8');
    if (current !== source) {
      console.error('build-client: src/client/client.js is stale; run node scripts/build-client.mjs');
      process.exit(1);
    }
    console.log(`build-client: up to date (${views.length} view(s): ${views.join(', ')})`);
  } else {
    writeFileSync(OUTPUT, source, 'utf8');
    console.log(`build-client: wrote ${OUTPUT} (${views.length} view(s): ${views.join(', ')})`);
  }
}

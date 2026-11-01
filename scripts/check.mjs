#!/usr/bin/env node
/**
 * Static checks with no dependencies:
 *   1. every source file parses as the module kind it claims to be
 *      (skipped automatically when the sandbox forbids child processes);
 *   2. the Seam dependency direction holds (definition <- provider <- host, etc.);
 *   3. the Client bundle mirrors the wire constants (it cannot import them);
 *   4. every Views manifest entry exists and self-registers;
 *   5. the Host half contains no slot or rendering vocabulary.
 *
 * `runChecks()` is exported so tests can assert on it in-process.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildClientSource } from './build-client.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/**
 * @param {{syntaxCheck?: boolean, root?: string}} [options]
 * @returns {{failures: string[], notes: string[]}}
 */
export function runChecks(options = {}) {
  const root = options.root ?? ROOT;
  const failures = [];
  const notes = [];

  const files = walk(join(root, 'src'));
  const jsFiles = files.filter((file) => file.endsWith('.js'));

  // 1. syntax -------------------------------------------------------------
  if (options.syntaxCheck !== false) {
    let spawnBlocked = false;
    for (const file of jsFiles) {
      try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
      } catch (error) {
        if (error.code === 'EPERM' || error.code === 'EACCES') {
          spawnBlocked = true;
          break;
        }
        failures.push(`syntax: ${relative(root, file)}: ${String(error.stderr ?? error.message).split('\n')[0]}`);
      }
    }
    if (spawnBlocked) notes.push('syntax check skipped: child processes are not permitted in this sandbox');
    else notes.push(`parsed ${jsFiles.length} source files`);
  }

  // 1b. encoding tripwire ------------------------------------------------
  // A PowerShell/console round-trip once re-encoded a source file from UTF-8 to
  // the ANSI code page, which is valid UTF-8 after the fact but unreadable and,
  // in one case, a syntax error. These characters only appear in such damage.
  const mojibake = /[\u9225\u922e\u9359\u951b\u9428\u93c4\u9286\u9229\uFFFD]/;
  for (const file of jsFiles) {
    const text = readFileSync(file, 'utf8');
    const line = text.split('\n').find((entry) => mojibake.test(entry));
    if (line !== undefined) {
      failures.push(`encoding: ${rel(file)} looks mis-decoded (mojibake): ${line.trim().slice(0, 80)}`);
    }
  }

  // 2. dependency direction ----------------------------------------------
  const rel = (file) => relative(root, file).replaceAll('\\', '/');
  const importsOf = (text) => [...text.matchAll(/^import\s[^\n]*?from\s+['"]([^'"]+)['"]/gm)].map((match) => match[1]);

  for (const file of jsFiles) {
    const path = rel(file);
    const text = readFileSync(file, 'utf8');
    const imports = importsOf(text);
    const isView = path.startsWith('src/client/views/');

    if (path.startsWith('src/definition/')) {
      for (const spec of imports) {
        if (!spec.startsWith('.')) failures.push(`architecture: ${path} imports non-relative "${spec}"`);
      }
      if (/from '\.\.\/(provider|consumer|host|client)/.test(text)) {
        failures.push(`architecture: ${path} must not import provider/consumer/host/client`);
      }
      if (/\b(document|window)\b/.test(text.replace(/\/\*[\s\S]*?\*\//g, ''))) {
        failures.push(`architecture: ${path} must stay free of DOM globals`);
      }
    }

    if (path.startsWith('src/provider/')) {
      for (const spec of imports) {
        if (spec.startsWith('node:')) continue;
        if (spec.includes('/consumer/') || spec.includes('/host/') || spec.includes('/client/')) {
          failures.push(`architecture: ${path} imports across the seam via "${spec}"`);
        }
      }
    }

    if (path.startsWith('src/consumer/')) {
      for (const spec of imports) {
        if (spec.includes('/provider/') || spec.includes('/host/')) {
          failures.push(`architecture: ${path} must not import a provider implementation ("${spec}")`);
        }
      }
    }

    if (path.startsWith('src/host/')) {
      for (const spec of imports) {
        if (spec.includes('/client/')) failures.push(`architecture: ${path} must not import the Client half ("${spec}")`);
      }
      if (/\bslots\.(register|inject)\b|className\s*[:=]|React\.createElement|<div\b/.test(text)) {
        failures.push(`architecture: ${path} contains rendering/slot vocabulary; the Host must stay UI-agnostic`);
      }
    }

    if (path === 'src/client/client.js') {
      for (const spec of imports) {
        if (spec.includes('/provider/') || spec.includes('/consumer/') || spec.includes('/host/')) {
          failures.push(`architecture: ${path} must not import Host internals ("${spec}")`);
        }
      }
    }

    if (isView && imports.length > 0) {
      failures.push(`architecture: ${path} is a classic script and must not import modules`);
    }
  }

  // 3. mirrored wire constants -------------------------------------------
  const protocol = readFileSync(join(root, 'src/definition/protocol.js'), 'utf8');
  const client = readFileSync(join(root, 'src/client/client.js'), 'utf8');

  const protocolVersion = /PROTOCOL_VERSION\s*=\s*(\d+)/.exec(protocol)?.[1];
  const clientVersion = /PROTOCOL_VERSION\s*=\s*(\d+)/.exec(client)?.[1];
  if (protocolVersion !== clientVersion) {
    failures.push(`wire: PROTOCOL_VERSION differs (host ${protocolVersion}, client ${clientVersion})`);
  }

  const prefix = /ROUTE_PREFIX\s*=\s*'([^']+)'/.exec(protocol)?.[1];
  const clientPrefix = /ROUTE_PREFIX\s*=\s*'([^']+)'/.exec(client)?.[1];
  if (prefix !== clientPrefix) failures.push(`wire: ROUTE_PREFIX differs (host ${prefix}, client ${clientPrefix})`);

  for (const key of ['snapshot', 'stream', 'viewConfig', 'viewsManifest', 'viewsAssetPrefix']) {
    const pattern = new RegExp(`${key}:\\s*\`[^\`]*\\$\\{ROUTE_PREFIX\\}([^\`]*)\``);
    const host = pattern.exec(protocol)?.[1];
    const mirror = pattern.exec(client)?.[1];
    if (host !== mirror) failures.push(`wire: route "${key}" differs (host ${host}, client ${mirror})`);
  }

  // 4. views manifest and the generated bundle ---------------------------
  const manifest = JSON.parse(readFileSync(join(root, 'src/client/views/index.json'), 'utf8'));
  for (const entry of manifest.views ?? []) {
    const file = join(root, 'src/client/views', entry.script);
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      failures.push(`views: manifest lists "${entry.script}" but the file is missing`);
      continue;
    }
    if (!text.includes(`register('${entry.id}'`)) {
      failures.push(`views: "${entry.script}" does not register id "${entry.id}"`);
    }
    if (!/supportedSlots\s*:/.test(text)) failures.push(`views: "${entry.script}" has no supportedSlots()`);
    if (!/getConfigSchema\s*:/.test(text)) failures.push(`views: "${entry.script}" has no getConfigSchema()`);
  }

  // The Client bundle is generated: every View must be inlined in it, and the
  // committed file must match what the builder produces right now.
  let built;
  try {
    built = buildClientSource();
  } catch (error) {
    failures.push(`bundle: the builder failed (${String(error?.message ?? error)})`);
    built = null;
  }
  if (built !== null) {
    const onDisk = readFileSync(join(root, 'src/client/client.js'), 'utf8');
    if (onDisk !== built.source) {
      failures.push('bundle: src/client/client.js is stale; run `node scripts/build-client.mjs`');
    }
    for (const id of built.views) {
      if (!built.source.includes(`register('${id}'`)) {
        failures.push(`bundle: view "${id}" is not inlined into the Client bundle`);
      }
    }
  }
  notes.push(`views manifest: ${(manifest.views ?? []).length} entry(ies)`);

  return { failures, notes };
}

const entry = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
const invokedDirectly = entry === fileURLToPath(import.meta.url) || entry.endsWith('check.mjs');

if (invokedDirectly) {
  const { failures, notes } = runChecks();
  if (failures.length > 0) {
    console.error('check failed:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  for (const note of notes) console.log(`ok  ${note}`);
  console.log('check passed');
}

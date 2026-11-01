#!/usr/bin/env node
/**
 * Manual smoke probe against a RUNNING Harness (dev or installed profile).
 *
 *   node scripts/probe.mjs [baseUrl] [sessionId]
 *
 * It exercises the plugin's wire only: snapshot, SSE opening frame, View
 * manifest/script, and a path-traversal attempt. It never sends a prompt, so it
 * proves wiring, not token accounting (that is covered by tests/).
 */

const base = (process.argv[2] ?? 'http://127.0.0.1:3080').replace(/\/$/, '');
const sessionId = process.argv[3] ?? 'probe-session';
const PREFIX = '/api/dsh-token-control/v1';

/** @param {string} path */
async function getJson(path) {
  const response = await fetch(`${base}${path}`, { headers: { accept: 'application/json' } });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: response.status, json, text };
}

const results = {};

const snapshot = await getJson(`${PREFIX}/snapshot?sessionId=${encodeURIComponent(sessionId)}`);
results.snapshot = {
  status: snapshot.status,
  keys: snapshot.json?.viewModel ? Object.keys(snapshot.json.viewModel) : null,
  turn: snapshot.json?.viewModel?.turn ?? null,
  period: snapshot.json?.viewModel?.period ?? null,
};

const config = await getJson(`${PREFIX}/view-config`);
results.viewConfig = { status: config.status, views: config.json?.views ?? null, knownSlots: config.json?.knownSlots ?? null };

const manifest = await getJson(`${PREFIX}/assets/views/index.json`);
results.manifest = { status: manifest.status, views: manifest.json?.views ?? null };

const script = await fetch(`${base}${PREFIX}/assets/views/readout-bar.js`);
const scriptText = await script.text();
results.viewScript = { status: script.status, bytes: scriptText.length, registers: scriptText.includes("register('readout-bar'") };

const traversal = await fetch(`${base}${PREFIX}/assets/views/..%2F..%2Fpackage.json`);
results.traversal = { status: traversal.status };

const missing = await fetch(`${base}${PREFIX}/assets/views/nope.js`);
results.unknownView = { status: missing.status };

// SSE: read the opening frame, then close.
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 4000);
try {
  const response = await fetch(`${base}${PREFIX}/stream?sessionId=${encodeURIComponent(sessionId)}`, {
    headers: { accept: 'text/event-stream' },
    signal: controller.signal,
  });
  results.stream = { status: response.status, contentType: response.headers.get('content-type') };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Read past the `: connected` comment until the opening reset frame arrives.
  while (buffer.length < 65536 && !buffer.includes('event: reset')) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  const first = buffer.split('\n\n').find((frame) => frame.includes('event:')) ?? buffer;
  results.stream.firstEvent = first.split('\n')[0] ?? '';
  results.stream.hasData = buffer.includes('event: reset') && buffer.includes('"viewModel"');
  await reader.cancel();
} catch (error) {
  results.stream = { error: String(error?.name ?? error) };
} finally {
  clearTimeout(timeout);
}

console.log(JSON.stringify(results, null, 2));

const bad = [];
if (results.snapshot.status !== 200) bad.push('snapshot');
if (results.snapshot.keys?.join(',') !== 'schemaVersion,sessionId,turn,session,balance,period,meta') bad.push('snapshot keys');
if (results.viewConfig.status !== 200) bad.push('view-config');
if (results.manifest.status !== 200) bad.push('manifest');
if (results.viewScript.status !== 200 || results.viewScript.registers !== true) bad.push('view script');
if (results.traversal.status !== 404) bad.push('traversal guard');
if (results.unknownView.status !== 404) bad.push('unknown view guard');
if (results.stream?.status !== 200) bad.push('stream');
if (bad.length > 0) {
  console.error(`probe FAILED: ${bad.join(', ')}`);
  process.exit(1);
}
console.log('probe passed');

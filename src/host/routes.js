/**
 * HTTP carrier for the ViewModel.
 *
 * This file is the ONLY place that knows both `ctx.webServer` and the wire. It
 * contains no rendering logic and no slot names for the readout itself: it
 * serves JSON snapshots, an SSE delta stream, the View layout document, and the
 * Client View scripts listed in the package's manifest.
 *
 * Every response is built field by field from a computed ViewModel. Nothing from
 * a Session, an LLM response, or a credential is ever spread into a payload.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ERROR_CODES, PROTOCOL_VERSION, ROUTES, ROUTE_PREFIX, SSE_EVENT_FRAME, SSE_EVENT_RESET, isSessionId } from '../definition/protocol.js';
import { KNOWN_SLOTS, VIEW_CONFIG_SCHEMA_VERSION, resolveViewConfig } from '../consumer/view-config.js';
import { readJsonFile, viewConfigFile, writeJsonAtomic } from './paths.js';

const MAX_BODY_BYTES = 64 * 1024;
const SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {object} payload
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} code
 */
function sendError(res, status, code) {
  sendJson(res, status, { protocolVersion: PROTOCOL_VERSION, ok: false, error: { code } });
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<unknown>}
 */
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('body too large'), { code: ERROR_CODES.badRequest });
    chunks.push(chunk);
  }
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('body is not JSON'), { code: ERROR_CODES.badRequest });
  }
}

/**
 * @param {object} options
 * @param {ReturnType<typeof import('../consumer/hub.js').createHub>} options.hub
 * @param {ReturnType<typeof import('../consumer/ledger.js').createLedger>} options.ledger
 * @param {ReturnType<typeof import('../consumer/view-model-builder.js').createViewModelBuilder>} options.builder
 * @param {{refresh:()=>Promise<any>, snapshot:()=>any}} options.balanceState
 * @param {string} options.viewsDir absolute directory holding View scripts + manifest
 * @param {(sessionId:string) => Promise<void>} options.ensureSession
 * @param {() => void} options.onBalanceRefreshed
 */
export function createRoutes(options) {
  const { hub, builder, balanceState, viewsDir, ensureSession, onBalanceRefreshed } = options;

  /** @returns {Promise<{views: {id:string, script:string, label?:string}[]}>} */
  async function readManifest() {
    const raw = await readJsonFile(join(viewsDir, 'index.json'));
    const list = raw !== null && typeof raw === 'object' && Array.isArray(/** @type {any} */ (raw).views)
      ? /** @type {any[]} */ (/** @type {any} */ (raw).views)
      : [];
    const views = [];
    for (const entry of list) {
      if (entry === null || typeof entry !== 'object') continue;
      if (typeof entry.id !== 'string' || typeof entry.script !== 'string') continue;
      if (!SCRIPT_NAME.test(entry.script)) continue;
      views.push({ id: entry.id, script: entry.script, label: typeof entry.label === 'string' ? entry.label : undefined });
    }
    return { views };
  }

  /** @returns {Promise<{body:object, config:any}>} */
  async function viewConfigBody() {
    const manifest = await readManifest();
    const stored = await readJsonFile(viewConfigFile());
    const knownViewIds = manifest.views.map((v) => v.id);
    const { config, warnings } = resolveViewConfig(stored, { knownViewIds });
    return {
      config,
      body: {
        protocolVersion: PROTOCOL_VERSION,
        schemaVersion: VIEW_CONFIG_SCHEMA_VERSION,
        views: config.views,
        knownViews: manifest.views.map((v) => ({ id: v.id, label: v.label ?? v.id })),
        knownSlots: [...KNOWN_SLOTS],
        warnings,
      },
    };
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} sessionId
   */
  async function openStream(req, res, sessionId) {
    await ensureSession(sessionId);
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');

    /** @param {string} event @param {object} data */
    const send = (event, data) => {
      if (res.writableEnded) return;
      // Drop frames instead of buffering without bound when the page stalls.
      if (res.writableLength > 1_000_000) return;
      const name = event === 'reset' ? SSE_EVENT_RESET : SSE_EVENT_FRAME;
      res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const unsubscribe = hub.subscribe(sessionId, send);
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n');
    }, 15000);

    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on('close', cleanup);
    res.on('close', cleanup);

    // The subscriber has no previous frame yet, so this publish becomes its
    // opening `reset` rather than a delta.
    hub.publish(sessionId, builder.build(sessionId));
  }

  /**
   * @param {string} name
   * @param {string} subpath
   * @returns {boolean}
   */
  function routeMatches(name, subpath) {
    return subpath === name;
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      sendError(res, 400, ERROR_CODES.badRequest);
      return;
    }
    const method = req.method ?? 'GET';
    const subpath = url.pathname.slice(ROUTE_PREFIX.length) || '/';

    try {
      if (routeMatches('/snapshot', subpath) && method === 'GET') {
        const sessionId = url.searchParams.get('sessionId') ?? '';
        if (!isSessionId(sessionId)) {
          sendError(res, 400, ERROR_CODES.badRequest);
          return;
        }
        await ensureSession(sessionId);
        const viewModel = builder.build(sessionId);
        viewModel.meta.revision = hub.revision();
        sendJson(res, 200, {
          protocolVersion: PROTOCOL_VERSION,
          schemaVersion: viewModel.schemaVersion,
          revision: hub.revision(),
          viewModel,
        });
        return;
      }

      if (routeMatches('/stream', subpath) && method === 'GET') {
        const sessionId = url.searchParams.get('sessionId') ?? '';
        if (!isSessionId(sessionId)) {
          sendError(res, 400, ERROR_CODES.badRequest);
          return;
        }
        await openStream(req, res, sessionId);
        return;
      }

      if (routeMatches('/view-config', subpath) && method === 'GET') {
        const { body } = await viewConfigBody();
        sendJson(res, 200, body);
        return;
      }

      if (routeMatches('/view-config', subpath) && method === 'PUT') {
        const raw = await readJsonBody(req);
        const stored = raw !== null && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
        const manifest = await readManifest();
        const normalized = resolveViewConfig(
          { schemaVersion: VIEW_CONFIG_SCHEMA_VERSION, views: Array.isArray(stored.views) ? stored.views : [] },
          { knownViewIds: manifest.views.map((v) => v.id) },
        );
        await writeJsonAtomic(viewConfigFile(), normalized.config);
        const { body } = await viewConfigBody();
        sendJson(res, 200, { ...body, warnings: [...normalized.warnings, ...(body.warnings ?? [])] });
        return;
      }

      if (routeMatches('/balance/refresh', subpath) && method === 'POST') {
        const snapshot = await balanceState.refresh();
        onBalanceRefreshed();
        sendJson(res, 200, {
          protocolVersion: PROTOCOL_VERSION,
          ok: true,
          balance: {
            state: snapshot.state,
            cny: Number.isFinite(snapshot.amountCNY) ? snapshot.amountCNY : null,
            updatedAt: snapshot.updatedAt,
          },
        });
        return;
      }

      if (routeMatches('/assets/views/index.json', subpath) && method === 'GET') {
        const manifest = await readManifest();
        sendJson(res, 200, { schemaVersion: 1, views: manifest.views });
        return;
      }

      if (subpath.startsWith('/assets/views/') && method === 'GET') {
        const name = decodeURIComponent(subpath.slice('/assets/views/'.length));
        const manifest = await readManifest();
        const allowed = manifest.views.some((view) => view.script === name);
        if (!allowed || !SCRIPT_NAME.test(name)) {
          sendError(res, 404, ERROR_CODES.unknownRoute);
          return;
        }
        let source;
        try {
          source = await readFile(join(viewsDir, name), 'utf8');
        } catch {
          sendError(res, 404, ERROR_CODES.unknownRoute);
          return;
        }
        res.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(source),
        });
        res.end(source);
        return;
      }

      sendError(res, 404, ERROR_CODES.unknownRoute);
    } catch (error) {
      const code = typeof (/** @type {{code?:unknown}} */ (error)?.code) === 'string'
        ? String(/** @type {{code?:string}} */ (error).code)
        : ERROR_CODES.badRequest;
      sendError(res, 400, code);
    }
  }

  return { handle, routes: ROUTES, readManifest };
}

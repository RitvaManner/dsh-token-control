/**
 * Host half — the composition root.
 *
 * This is the only module that knows `ctx`, and the only one allowed to import
 * both `provider/` and `consumer/`. It wires the three seams, subscribes to the
 * session log, and hands the route layer a ViewModel builder.
 *
 * Every registration (events, timers, routes) goes through `ctx.effect`, so
 * unloading the plugin removes all of them.
 */

import { fileURLToPath } from 'node:url';

import { createViewModelBuilder } from '../consumer/view-model-builder.js';
import { createHub } from '../consumer/hub.js';
import { createLedger } from '../consumer/ledger.js';
import { createCalibrator } from '../provider/calibrator.js';
import { createBalanceState } from '../provider/balance-state.js';
import { createDeepSeekBalanceProvider } from '../provider/balance-deepseek.js';
import { createNullAlertSink } from '../provider/alerts-null.js';
import { createPolicyPeakPeriodProvider } from '../provider/peak-policy.js';
import { createTablePricingStrategy } from '../provider/pricing-table.js';
import { loadConfigSchema, resolveConfig } from './config.js';
import { createRoutes } from './routes.js';

export const inject = ['sessions', 'webServer', 'credentials', 'timer'];

/**
 * DSH's Config schema for this entry. `undefined` when the shipped schema
 * package cannot be resolved, in which case `resolveConfig` is the only
 * validation (see host/config.js).
 */
export const Config = await loadConfigSchema();

const VIEWS_DIR = fileURLToPath(new URL('../client/views/', import.meta.url));

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {unknown} rawConfig
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);

  const peakProvider = createPolicyPeakPeriodProvider();
  const pricing = createTablePricingStrategy({ peakProvider });
  const alerts = createNullAlertSink();
  const calibrator = createCalibrator();
  const ledger = createLedger({ pricing });
  const hub = createHub();

  /** Sessions whose ViewModel changed and that are waiting for the next tick. */
  const dirty = new Set();
  const markDirty = (sessionId) => dirty.add(sessionId);
  const markAllDirty = () => {
    for (const sessionId of hub.sessionIds()) dirty.add(sessionId);
  };

  const balanceProvider = createDeepSeekBalanceProvider({ credentials: ctx.credentials });
  const balanceState = createBalanceState({
    provider: balanceProvider,
    onChanged: () => markAllDirty(),
  });

  const builder = createViewModelBuilder({ ledger, peakProvider, balanceState, calibrator, pricing });

  /**
   * Fold a session's durable log into the ledger on first touch, so a page
   * reload (or a Host restart) shows the real numbers immediately.
   * @param {string} sessionId
   */
  async function ensureSession(sessionId) {
    if (ledger.has(sessionId)) return;
    const live = ctx.sessions.get(sessionId);
    if (live !== undefined) {
      try {
        ledger.hydrate(sessionId, live.snapshotEvents());
        return;
      } catch {
        ledger.hydrate(sessionId, []);
        return;
      }
    }
    try {
      const sessionQuery = ctx.get('sessionQuery');
      const snapshot = await sessionQuery?.readSession?.(sessionId);
      ledger.hydrate(sessionId, Array.isArray(snapshot?.events) ? snapshot.events : []);
    } catch {
      ledger.hydrate(sessionId, []);
    }
  }

  // ---- session log -------------------------------------------------------

  /** @type {Map<string, number|null>} */
  const balanceAtTurnStart = new Map();

  ctx.effect(
    () =>
      ctx.on('session/event', (session, event) => {
        const sessionId = session.id;
        if (event.type === 'turn/start') {
          const snapshot = balanceState.snapshot();
          balanceAtTurnStart.set(sessionId, snapshot.state === 'ok' ? snapshot.amountCNY : null);
        }

        if (!ledger.ingestEvent(sessionId, event)) return;
        markDirty(sessionId);

        if (event.type === 'turn/end') {
          const computedMicro = ledger.display(sessionId).turnMicro;
          const before = balanceAtTurnStart.get(sessionId) ?? null;
          balanceAtTurnStart.delete(sessionId);

          if (before !== null && computedMicro > 0) {
            // Refresh first, then calibrate the next turns against the observed
            // wallet delta. One sample never rewrites this turn's own number.
            void balanceState.refresh().then((snapshot) => {
              if (snapshot.state === 'ok' && Number.isFinite(snapshot.amountCNY)) {
                calibrator.observe({
                  computedMicro,
                  balanceBeforeCNY: before,
                  balanceAfterCNY: snapshot.amountCNY,
                });
                markAllDirty();
              }
            });
          } else if (config.balanceRefreshOnTurnEnd) {
            void balanceState.refresh();
          }
        }
      }),
    'token-control: session log',
  );

  ctx.effect(
    () =>
      ctx.on('agent/assistant-stream', ({ agent, frame }) => {
        if (ledger.ingestStream(agent.id, frame)) markDirty(agent.id);
      }),
    'token-control: assistant stream',
  );

  ctx.effect(
    () =>
      ctx.on('session/disposed', (session) => {
        ledger.drop(session.id);
        balanceAtTurnStart.delete(session.id);
        dirty.delete(session.id);
      }),
    'token-control: session disposal',
  );

  // ---- broadcast ---------------------------------------------------------

  // Token deltas arrive per chunk; coalescing them into a 250 ms tick keeps the
  // browser cadence stable and the Host cheap.
  ctx.effect(
    () =>
      ctx.timer.interval(() => {
        if (dirty.size === 0) return;
        for (const sessionId of [...dirty]) {
          dirty.delete(sessionId);
          if (!hub.hasSubscribers(sessionId)) continue;
          hub.publish(sessionId, builder.build(sessionId));
        }
      }, 250),
    'token-control: broadcast tick',
  );

  // Period boundaries and their <=5 min reminder need a slow heartbeat even
  // when no tokens flow. The diff publisher suppresses unchanged frames.
  ctx.effect(
    () => ctx.timer.interval(markAllDirty, 15000),
    'token-control: period tick',
  );

  // ---- balance -----------------------------------------------------------

  ctx.effect(() => {
    const poll = () => {
      void balanceState.refresh();
    };
    const initial = ctx.timer.timeout(poll, 800);
    const interval = ctx.timer.interval(poll, config.balanceRefreshSeconds * 1000);
    return () => {
      initial();
      interval();
      balanceState.cancel();
    };
  }, 'token-control: balance poller');

  // ---- routes ------------------------------------------------------------

  const routes = createRoutes({
    hub,
    builder,
    balanceState,
    viewsDir: VIEWS_DIR,
    ensureSession,
    onBalanceRefreshed: markAllDirty,
  });

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/api/dsh-token-control/v1',
        handler: routes.handle,
      }),
    'token-control: routes',
  );

  // `alerts` is deliberately wired but inert in v1; keeping the reference here
  // documents the seam without starting any notification path.
  void alerts;
}

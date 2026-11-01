/**
 * ViewModel builder — the ONLY producer of the browser-facing value.
 *
 * Every field is copied explicitly from a computed source; nothing is spread
 * from a Session, an event, a provider response, or a credential. That is what
 * makes "the browser never sees Host objects" a checkable property rather than
 * a promise (tests/view-model.test.mjs asserts the key set).
 */

import { VIEW_MODEL_SCHEMA_VERSION, emptyCostView, emptyTokenView } from '../definition/view-model.js';
import { microToCNY } from '../definition/money.js';

/** @param {import('../definition/tokens.js').TokenBuckets} buckets @param {boolean} estimated */
function tokenView(buckets, estimated) {
  return {
    input: buckets.inputTotal,
    output: buckets.output,
    cacheHit: buckets.cacheHit,
    cacheMiss: buckets.cacheMiss,
    cacheWrite: buckets.cacheWrite,
    reasoning: buckets.reasoning,
    total: buckets.total,
    estimated,
  };
}

/**
 * @param {{ledger: ReturnType<typeof import('./ledger.js').createLedger>,
 *   peakProvider: import('../definition/seam.js').PeakPeriodProvider,
 *   balanceState: {snapshot: () => any},
 *   calibrator: {apply:(micro:number)=>number, state:()=>{applied:boolean}},
 *   pricing: import('../definition/seam.js').PricingStrategy,
 *   now?: () => number,
 *   reminderSeconds?: number}} options
 */
export function createViewModelBuilder(options) {
  const {
    ledger,
    peakProvider,
    balanceState,
    calibrator,
    pricing,
    now = Date.now,
    reminderSeconds = 300,
  } = options;

  /**
   * @param {string} sessionId
   * @returns {object} a fresh ViewModel (never shared between revisions)
   */
  function build(sessionId) {
    const nowMs = now();
    const shown = ledger.display(sessionId);
    const totals = ledger.totals(sessionId);
    const balance = balanceState.snapshot();
    const period = peakProvider.getCurrentPeriod(nowMs);
    const calibration = calibrator.state();

    const settled = shown.state === 'settled' || shown.state === 'error';
    const hasTokens = shown.buckets.total > 0;
    const turnMicro = calibration.applied ? calibrator.apply(shown.turnMicro) : shown.turnMicro;

    const describe = typeof pricing.describe === 'function' ? pricing.describe() : { tableVersion: '', currency: 'CNY', models: [], source: null };
    const usedTableModels = shown.models.filter((m) => !describe.models.includes(m));

    /** @type {import('../definition/view-model.js').CostView} */
    const cost = hasTokens
      ? {
          cny: microToCNY(turnMicro),
          settled,
          basis: usedTableModels.length > 0 ? 'unknown-model' : calibration.applied ? 'table+calibrated' : 'table',
          breakdown: null,
        }
      : emptyCostView();

    return {
      schemaVersion: VIEW_MODEL_SCHEMA_VERSION,
      sessionId,
      turn: {
        index: shown.turnIndex,
        state: shown.state === 'streaming' ? 'streaming' : shown.state === 'error' ? 'error' : shown.state === 'settled' ? 'settled' : 'idle',
        live: shown.live,
        tokens: hasTokens ? tokenView(shown.buckets, shown.estimated) : emptyTokenView(),
        cost,
        models: [...shown.models],
      },
      session: {
        tokens: tokenView(totals.buckets, false),
        costCNY: totals.costMicro > 0 ? microToCNY(calibration.applied ? calibrator.apply(totals.costMicro) : totals.costMicro) : null,
      },
      balance: {
        state: balance.state,
        cny: Number.isFinite(balance.amountCNY) ? balance.amountCNY : null,
        updatedAt: balance.updatedAt ?? null,
        staleSeconds: balance.staleSeconds ?? null,
        source: balance.source ?? null,
        error: balance.error === null || balance.error === undefined ? null : { code: String(balance.error.code) },
      },
      period: {
        kind: period.kind,
        label: period.label,
        ratioOfPeak: period.ratioOfPeak,
        calendarYear: period.calendarYear,
        estimated: period.estimated === true,
        nextTransitionAt: period.nextTransitionAt,
        remainingSeconds: period.remainingSeconds,
        remind: period.remainingSeconds > 0 && period.remainingSeconds <= reminderSeconds,
        upcoming: period.upcoming,
      },
      meta: {
        hostTime: nowMs,
        revision: 0,
        currency: 'CNY',
      },
    };
  }

  return { build };
}

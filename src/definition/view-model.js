/**
 * The one value the Host produces for the UI: a UI-agnostic ViewModel.
 *
 * Compatibility contract (enforced by tests/view-model.test.mjs):
 *  1. Fields are only ADDED within a schemaVersion; none is renamed, removed,
 *     or given a new meaning.
 *  2. Every added field is optional. A View that does not know a field ignores
 *     it; it must never throw because a field is absent.
 *  3. The Host builds this object field by field (`buildViewModel` in
 *     `consumer/view-model-builder.js`); it never stringifies a Session.
 */

export const VIEW_MODEL_SCHEMA_VERSION = 1;

/**
 * @typedef {{ input:number, output:number, cacheHit:number, cacheMiss:number,
 *   cacheWrite:number, reasoning:number, total:number, estimated:boolean }} TokenView
 * @typedef {{ cny:number|null, settled:boolean, basis:'table'|'table+calibrated'|'unknown-model',
 *   breakdown:{missCNY:number,hitCNY:number,outputCNY:number}|null }} CostView
 */

/**
 * @param {string} sessionId
 * @param {number} nowMs
 * @returns {object} an empty, schema-valid ViewModel (used before any event).
 */
export function createEmptyViewModel(sessionId, nowMs) {
  return {
    schemaVersion: VIEW_MODEL_SCHEMA_VERSION,
    sessionId: String(sessionId),
    turn: {
      index: 0,
      state: 'idle',
      live: false,
      tokens: emptyTokenView(),
      cost: emptyCostView(),
      models: [],
    },
    session: { tokens: emptyTokenView(), costCNY: null },
    balance: {
      state: 'unconfigured',
      cny: null,
      updatedAt: null,
      staleSeconds: null,
      source: null,
      error: null,
    },
    period: {
      kind: 'idle',
      label: '空闲',
      ratioOfPeak: 0.5,
      calendarYear: 0,
      estimated: false,
      nextTransitionAt: null,
      remainingSeconds: 0,
      remind: false,
      upcoming: 'peak',
    },
    meta: { hostTime: nowMs, revision: 0, currency: 'CNY' },
  };
}

/** @returns {TokenView} */
export function emptyTokenView() {
  return {
    input: 0,
    output: 0,
    cacheHit: 0,
    cacheMiss: 0,
    cacheWrite: 0,
    reasoning: 0,
    total: 0,
    estimated: false,
  };
}

/** @returns {CostView} */
export function emptyCostView() {
  return { cny: null, settled: false, basis: 'table', breakdown: null };
}

/**
 * Apply an incremental patch to a ViewModel without losing fields this client
 * does not know about. Unknown keys in the patch are kept as-is (a newer Host
 * may add sections), and only object-valued known sections are shallow-merged.
 *
 * @param {object} previous
 * @param {object} patch
 * @returns {object}
 */
export function applyViewModelPatch(previous, patch) {
  if (patch === null || typeof patch !== 'object') return previous;
  const next = { ...previous };
  for (const [key, value] of Object.entries(patch)) {
    const known = previous[key];
    if (known !== null && typeof known === 'object' && !Array.isArray(known) && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      next[key] = { ...known, ...value };
    } else {
      next[key] = value;
    }
  }
  return next;
}

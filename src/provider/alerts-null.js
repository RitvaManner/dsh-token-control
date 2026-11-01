/**
 * NullAlertSink — the reserved AlertSink seam, wired but inert in v1.
 *
 * Adding alerts later means a new `alerts-*.js` provider (or a standalone View)
 * plus one line in `host/index.js`; the data layer and the ViewModel do not
 * change.
 */

/** @returns {import('../definition/seam.js').AlertSink} */
export function createNullAlertSink() {
  return {
    onPeakTransition() {},
    onBalanceStale() {},
    onBudgetThreshold() {},
  };
}

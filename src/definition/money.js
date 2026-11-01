/**
 * Money helpers. Everything accumulates in integer micro-yuan (1e-6 CNY).
 *
 * DeepSeek prices are quoted in CNY per 1_000_000 tokens, so
 *
 *     microCNY = round(unitPriceCNYPerMillion * tokens)
 *
 * because unitPrice/1e6 (per token) * tokens * 1e6 (micro per yuan)
 * simplifies to unitPrice * tokens. Integer accumulation avoids the drift a
 * double-per-turn accumulator shows after a few hundred turns.
 */

export const MICRO_PER_CNY = 1e6;

/**
 * @param {number} tokens
 * @param {number} unitPriceCNYPerMillion
 * @returns {number} integer micro-yuan
 */
export function microCNYFrom(tokens, unitPriceCNYPerMillion) {
  const t = Number(tokens);
  const p = Number(unitPriceCNYPerMillion);
  if (!Number.isFinite(t) || !Number.isFinite(p) || t <= 0 || p <= 0) return 0;
  return Math.round(t * p);
}

/**
 * @param {number} micro
 * @returns {number} CNY as a float, rounded to 1e-6
 */
export function microToCNY(micro) {
  return Math.round(Number(micro) || 0) / MICRO_PER_CNY;
}

/**
 * @param {number} cny
 * @returns {number} integer micro-yuan
 */
export function cnyToMicro(cny) {
  const n = Number(cny);
  return Number.isFinite(n) ? Math.round(n * MICRO_PER_CNY) : 0;
}

/**
 * Format a CNY amount with a fixed number of decimals, without grouping noise.
 * @param {number|null|undefined} cny
 * @param {number} [decimals]
 * @returns {string}
 */
export function formatCNY(cny, decimals = 4) {
  const n = Number(cny);
  if (!Number.isFinite(n)) return '—';
  const digits = Math.min(6, Math.max(0, Math.floor(decimals)));
  return n.toFixed(digits);
}

/**
 * Clamp a ratio into [min, max]; `fallback` for non-numbers.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @param {number} [fallback]
 * @returns {number}
 */
export function clampRatio(value, min, max, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

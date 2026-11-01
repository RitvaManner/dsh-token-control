/**
 * Token bookkeeping for DeepSeek usage, in the shape DSH reports it.
 *
 * CRITICAL SEMANTICS — `TokenUsage.inputTokens` from DSH is the UNCACHED
 * (cache-miss) portion, not the whole prompt. The provider adapter computes
 *
 *     input = max(0, prompt_tokens - cacheReadTokens - cacheWriteTokens)
 *
 * (see the installed harness: the OpenAI-compatible usage mapper, and
 * `token-meter`'s `uncachedInputTokens`). DeepSeek additionally reports
 * `prompt_cache_hit_tokens`, which DSH surfaces as `cacheReadTokens`.
 *
 * Therefore:
 *     cacheMiss  = inputTokens
 *     cacheHit   = cacheReadTokens
 *     inputTotal = cacheMiss + cacheHit + cacheWrite
 *     total      = inputTotal + outputTokens
 *
 * Treating `inputTokens` as the prompt total would double count cache hits and
 * overcharge every cached turn; tests/tokens.test.mjs pins this down.
 */

/**
 * @typedef {object} TokenBuckets
 * @property {number} cacheMiss
 * @property {number} cacheHit
 * @property {number} cacheWrite
 * @property {number} output
 * @property {number} reasoning
 * @property {number} inputTotal
 * @property {number} total
 */

/** @returns {TokenBuckets} */
export function emptyBuckets() {
  return { cacheMiss: 0, cacheHit: 0, cacheWrite: 0, output: 0, reasoning: 0, inputTotal: 0, total: 0 };
}

/**
 * @param {number} value
 * @returns {number} a non-negative safe integer
 */
function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Normalize one provider `TokenUsage` into our buckets.
 * @param {{inputTokens?:number, outputTokens?:number, cacheReadTokens?:number,
 *   cacheWriteTokens?:number, reasoningTokens?:number, totalTokens?:number}|undefined|null} usage
 * @returns {TokenBuckets}
 */
export function normalizeUsage(usage) {
  if (usage === null || usage === undefined) return emptyBuckets();
  const cacheMiss = count(usage.inputTokens);
  const cacheHit = count(usage.cacheReadTokens);
  const cacheWrite = count(usage.cacheWriteTokens);
  const output = count(usage.outputTokens);
  const reasoning = count(usage.reasoningTokens);
  const inputTotal = cacheMiss + cacheHit + cacheWrite;
  return { cacheMiss, cacheHit, cacheWrite, output, reasoning, inputTotal, total: inputTotal + output };
}

/**
 * @param {TokenBuckets} a
 * @param {TokenBuckets} b
 * @returns {TokenBuckets}
 */
export function addBuckets(a, b) {
  const cacheMiss = a.cacheMiss + b.cacheMiss;
  const cacheHit = a.cacheHit + b.cacheHit;
  const cacheWrite = a.cacheWrite + b.cacheWrite;
  const output = a.output + b.output;
  const reasoning = a.reasoning + b.reasoning;
  const inputTotal = cacheMiss + cacheHit + cacheWrite;
  return { cacheMiss, cacheHit, cacheWrite, output, reasoning, inputTotal, total: inputTotal + output };
}

/**
 * @param {TokenBuckets} b
 * @returns {boolean}
 */
export function bucketsEmpty(b) {
  return b.cacheMiss === 0 && b.cacheHit === 0 && b.cacheWrite === 0 && b.output === 0 && b.reasoning === 0;
}

/**
 * Character-based estimate used ONLY while a call is streaming and the provider
 * has not reported usage yet. Clearly marked `estimated` on the wire.
 * DeepSeek reports usage at the tail of the stream, so exact live counts are not
 * available by construction.
 *
 * @param {number} chars
 * @returns {number}
 */
export function estimateOutputTokens(chars) {
  const n = Number(chars);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // ~2.2 characters per token is the middle of the CJK/latin band this UI sees.
  return Math.ceil(n / 2.2);
}

/**
 * Turn ledger — the only place that folds token usage.
 *
 * Two inputs feed it:
 *   1. durable `session/event` records (the replay source), and
 *   2. transient `agent/assistant-stream` frames (the live overlay).
 *
 * A final assistant message always replaces its own streamed estimate for the
 * same call, so the settled numbers come from the durable log and the live
 * numbers only ever paper over the gap before that commit.
 *
 * This module depends on `definition` only; the PricingStrategy arrives as an
 * injected instance and is used through its interface.
 */

import { addBuckets, bucketsEmpty, emptyBuckets, estimateOutputTokens, normalizeUsage } from '../definition/tokens.js';

const MAX_SESSIONS = 64;

/**
 * @param {{pricing: import('../definition/seam.js').PricingStrategy,
 *   now?: () => number, maxSessions?: number}} options
 */
export function createLedger({ pricing, now = Date.now, maxSessions = MAX_SESSIONS }) {
  /** @type {Map<string, any>} */
  const sessions = new Map();

  /** @param {string} sessionId */
  function ensure(sessionId) {
    let state = sessions.get(sessionId);
    if (state === undefined) {
      state = {
        sessionId,
        turnIndex: 0,
        turnState: 'idle',
        turn: { buckets: emptyBuckets(), costMicro: 0, models: [], steps: 0 },
        total: { buckets: emptyBuckets(), costMicro: 0 },
        live: null,
        lastEventAt: now(),
      };
      sessions.set(sessionId, state);
      // Bounded memory: drop the least recently touched session. Subscribers of
      // a dropped session simply re-hydrate from its log on the next request.
      if (sessions.size > maxSessions) {
        let oldestKey = null;
        let oldestAt = Infinity;
        for (const [key, value] of sessions) {
          if (value.lastEventAt < oldestAt) {
            oldestAt = value.lastEventAt;
            oldestKey = key;
          }
        }
        if (oldestKey !== null && oldestKey !== sessionId) sessions.delete(oldestKey);
      }
    }
    return state;
  }

  /**
   * @param {any} state
   * @param {import('../definition/tokens.js').TokenBuckets} buckets
   * @param {{model:string, provider:string, atMs:number}} call
   */
  function charge(state, buckets, call) {
    if (bucketsEmpty(buckets)) return;
    const breakdown = pricing.price(buckets, call);
    state.turn.buckets = addBuckets(state.turn.buckets, buckets);
    state.turn.costMicro += breakdown.totalMicro;
    state.turn.steps += 1;
    state.total.buckets = addBuckets(state.total.buckets, buckets);
    state.total.costMicro += breakdown.totalMicro;
    if (call.model && !state.turn.models.includes(call.model)) state.turn.models.push(call.model);
  }

  /**
   * Fold ONE durable session event.
   * @param {string} sessionId
   * @param {{type:string, time:number, data:any}} event
   * @returns {boolean} whether the ledger changed
   */
  function ingestEvent(sessionId, event) {
    if (event === null || typeof event !== 'object') return false;
    const state = ensure(sessionId);
    state.lastEventAt = now();

    switch (event.type) {
      case 'turn/start': {
        state.turnIndex = Number(event.data?.turn ?? state.turnIndex + 1);
        state.turnState = 'streaming';
        state.turn = { buckets: emptyBuckets(), costMicro: 0, models: [], steps: 0 };
        state.live = null;
        return true;
      }
      case 'assistant/message': {
        const data = event.data ?? {};
        const source = data.message?.source ?? {};
        const buckets = normalizeUsage(data.usage);
        state.turnIndex = Number(data.turn ?? state.turnIndex);
        charge(state, buckets, {
          model: String(source.model ?? ''),
          provider: String(source.provider ?? ''),
          atMs: Number.isFinite(event.time) ? event.time : now(),
        });
        // The committed message supersedes the live overlay for this call.
        state.live = null;
        return true;
      }
      case 'turn/end': {
        const kind = event.data?.reason?.kind;
        state.turnIndex = Number(event.data?.turn ?? state.turnIndex);
        state.turnState = kind === 'error' ? 'error' : 'settled';
        state.live = null;
        return true;
      }
      default:
        return false;
    }
  }

  /**
   * Fold ONE transient assistant-stream frame.
   * @param {string} sessionId
   * @param {{type:string, turn?:number, step?:number, chunk?:any, time?:number}} frame
   * @returns {boolean}
   */
  function ingestStream(sessionId, frame) {
    if (frame === null || typeof frame !== 'object') return false;
    const state = ensure(sessionId);
    state.lastEventAt = now();

    if (frame.type === 'start') {
      state.turnIndex = Number(frame.turn ?? state.turnIndex);
      state.turnState = 'streaming';
      state.live = { outputChars: 0, reasoningChars: 0, usage: null, startedAt: now() };
      return true;
    }
    if (frame.type === 'end') {
      state.live = null;
      return true;
    }
    if (frame.type !== 'chunk' || state.live === null) return false;

    const chunk = frame.chunk;
    if (chunk === null || typeof chunk !== 'object') return false;
    switch (chunk.type) {
      case 'text-delta':
        state.live.outputChars += String(chunk.text ?? '').length;
        return true;
      case 'reasoning-delta':
        state.live.reasoningChars += String(chunk.text ?? '').length;
        return true;
      case 'usage':
        state.live.usage = normalizeUsage(chunk.usage);
        return true;
      default:
        return false;
    }
  }

  /**
   * Replace a session's state by folding its durable log (used on first read
   * after a page reload or a Host restart). Idempotent.
   * @param {string} sessionId
   * @param {readonly {type:string, time:number, data:any}[]} events
   */
  function hydrate(sessionId, events) {
    const state = ensure(sessionId);
    state.turnIndex = 0;
    state.turnState = 'idle';
    state.turn = { buckets: emptyBuckets(), costMicro: 0, models: [], steps: 0 };
    state.total = { buckets: emptyBuckets(), costMicro: 0 };
    state.live = null;
    for (const event of events) ingestEvent(sessionId, event);
    return state;
  }

  /**
   * What the UI should show right now: durable turn totals plus the in-flight
   * call, which is either provider usage or a marked character estimate.
   * @param {string} sessionId
   * @returns {{buckets: import('../definition/tokens.js').TokenBuckets,
   *   estimated:boolean, live:boolean, state:string, turnIndex:number,
   *   turnMicro:number, sessionMicro:number, models:string[]}}
   */
  function display(sessionId) {
    const state = sessions.get(sessionId);
    if (state === undefined) {
      return {
        buckets: emptyBuckets(),
        estimated: false,
        live: false,
        state: 'idle',
        turnIndex: 0,
        turnMicro: 0,
        sessionMicro: 0,
        models: [],
      };
    }
    let buckets = state.turn.buckets;
    let estimated = false;
    const live = state.live !== null;
    if (state.live !== null) {
      if (state.live.usage !== null) {
        buckets = addBuckets(buckets, state.live.usage);
      } else {
        const chars = state.live.outputChars + state.live.reasoningChars;
        const estimatedOutput = estimateOutputTokens(chars);
        if (estimatedOutput > 0) {
          buckets = addBuckets(buckets, { ...emptyBuckets(), output: estimatedOutput, total: estimatedOutput });
          estimated = true;
        }
      }
    }
    return {
      buckets,
      estimated,
      live,
      state: state.turnState,
      turnIndex: state.turnIndex,
      turnMicro: state.turn.costMicro,
      sessionMicro: state.total.costMicro,
      models: [...state.turn.models],
    };
  }

  /**
   * Whole-session cumulative buckets and cost (durable only, no live overlay).
   * @param {string} sessionId
   * @returns {{buckets: import('../definition/tokens.js').TokenBuckets, costMicro:number}}
   */
  function totals(sessionId) {
    const state = sessions.get(sessionId);
    if (state === undefined) return { buckets: emptyBuckets(), costMicro: 0 };
    return { buckets: state.total.buckets, costMicro: state.total.costMicro };
  }

  return {
    ingestEvent,
    ingestStream,
    hydrate,
    display,
    totals,
    has: (sessionId) => sessions.has(sessionId),
    drop(sessionId) {
      sessions.delete(sessionId);
    },
    sessions: () => [...sessions.keys()],
    raw: (sessionId) => sessions.get(sessionId),
  };
}

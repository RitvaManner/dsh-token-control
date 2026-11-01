/**
 * Hub — subscriber bookkeeping and incremental broadcast, with no knowledge of
 * how frames travel. The Host route layer owns the SSE transport; this module
 * only decides who receives what and how much of it changed.
 *
 * A frame is `{revision, patch}` where `patch` holds only the top-level sections
 * whose JSON changed since the subscriber's last frame. `revision` increments
 * once per published ViewModel.
 */

import { VIEW_MODEL_SECTIONS } from '../definition/protocol.js';

/**
 * @param {{now?: () => number}} [options]
 */
export function createHub(options = {}) {
  const now = options.now ?? Date.now;
  /** @type {Map<string, Set<{send:(event:string, data:object)=>void, last:object|null}>>} */
  const subscribers = new Map();
  let revision = 0;

  /** @param {string} sessionId */
  function subscribersOf(sessionId) {
    let set = subscribers.get(sessionId);
    if (set === undefined) {
      set = new Set();
      subscribers.set(sessionId, set);
    }
    return set;
  }

  /**
   * @param {string} sessionId
   * @param {(event:string, data:object) => void} send
   * @returns {() => void} unsubscribe
   */
  function subscribe(sessionId, send) {
    const entry = { send, last: null };
    subscribersOf(sessionId).add(entry);
    return () => {
      const set = subscribers.get(sessionId);
      if (set === undefined) return;
      set.delete(entry);
      if (set.size === 0) subscribers.delete(sessionId);
    };
  }

  /**
   * Send the opening snapshot to one subscriber.
   * @param {{send:(event:string, data:object)=>void, last:object|null}} entry
   * @param {object} viewModel
   */
  function sendReset(entry, viewModel) {
    revision += 1;
    const value = { ...viewModel, meta: { ...viewModel.meta, hostTime: now(), revision } };
    entry.last = value;
    entry.send('reset', { revision, viewModel: value });
  }

  /**
   * Publish a ViewModel to every subscriber of that session.
   * @param {string} sessionId
   * @param {object} viewModel
   * @returns {number} the revision used, or 0 when nobody is listening
   */
  function publish(sessionId, viewModel) {
    const set = subscribers.get(sessionId);
    if (set === undefined || set.size === 0) return 0;

    revision += 1;
    const value = { ...viewModel, meta: { ...viewModel.meta, hostTime: now(), revision } };

    for (const entry of set) {
      if (entry.last === null) {
        entry.last = value;
        entry.send('reset', { revision, viewModel: value });
        continue;
      }
      /** @type {Record<string, unknown>} */
      const patch = {};
      let changed = false;
      for (const key of VIEW_MODEL_SECTIONS) {
        if (JSON.stringify(entry.last[key]) !== JSON.stringify(value[key])) {
          patch[key] = value[key];
          changed = true;
        }
      }
      entry.last = value;
      if (changed) entry.send('frame', { revision, patch });
    }
    return revision;
  }

  return {
    subscribe,
    sendReset,
    publish,
    hasSubscribers: (sessionId) => (subscribers.get(sessionId)?.size ?? 0) > 0,
    sessionIds: () => [...subscribers.keys()],
    subscriberCount: () => [...subscribers.values()].reduce((sum, set) => sum + set.size, 0),
    revision: () => revision,
  };
}

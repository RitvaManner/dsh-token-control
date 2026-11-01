/**
 * View layout configuration: which Views are enabled, where each one mounts, and
 * each View's own opaque settings.
 *
 * The Host stores this document but deliberately knows nothing about View
 * schemas — those live in the browser, one `getConfigSchema()` per View. That is
 * what lets a new View ship as "one new file + one manifest line" without
 * touching the Host.
 */

export const VIEW_CONFIG_SCHEMA_VERSION = 1;

/** Slot a fresh install mounts into (directly above the composer card). */
export const DEFAULT_SLOT = 'conversation.input.dock';

/** Slots this build declares as valid targets for a View that supports them. */
export const KNOWN_SLOTS = Object.freeze([
  'conversation.input.dock',
  'conversation.composer.dock',
  'conversation.composer.bar',
]);

/**
 * Built-in defaults. A View that is not listed stays unregistered until the user
 * enables it — adding a new View never silently changes the user's layout.
 */
export function defaultViewConfig() {
  return {
    schemaVersion: VIEW_CONFIG_SCHEMA_VERSION,
    views: [
      {
        id: 'readout-bar',
        enabled: true,
        slot: DEFAULT_SLOT,
        order: 25,
        config: {
          compact: false,
          showBalance: true,
          showCacheSplit: true,
          showCountdown: true,
          decimals: 4,
        },
      },
    ],
  };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Opaque per-View settings are kept shallow and primitive so a broken View
 * cannot smuggle a payload or blow up the settings file.
 *
 * @param {unknown} value
 * @returns {Record<string, string|number|boolean|null>}
 */
function sanitizeViewSettings(value) {
  if (!isPlainObject(value)) return {};
  /** @type {Record<string, string|number|boolean|null>} */
  const out = {};
  let count = 0;
  for (const [key, entry] of Object.entries(value)) {
    if (count >= 32) break;
    if (typeof key !== 'string' || key.length === 0 || key.length > 64) continue;
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') {
      out[key] = typeof entry === 'string' && entry.length > 512 ? entry.slice(0, 512) : entry;
      count += 1;
    } else if (typeof entry === 'number' && Number.isFinite(entry)) {
      out[key] = entry;
      count += 1;
    }
  }
  return out;
}

/**
 * Normalize an arbitrary stored document into a safe layout.
 *
 * Unknown View ids, unknown slots, and malformed entries are dropped with a
 * warning instead of failing: a config written by a newer build must not break
 * an older one, and vice versa.
 *
 * @param {unknown} raw
 * @param {{knownViewIds?: readonly string[], knownSlots?: readonly string[]}} [options]
 * @returns {{config: ReturnType<typeof defaultViewConfig>, warnings: string[]}}
 */
export function normalizeViewConfig(raw, options = {}) {
  const knownViewIds = options.knownViewIds ?? ['readout-bar'];
  const knownSlots = options.knownSlots ?? KNOWN_SLOTS;
  const warnings = [];

  if (!isPlainObject(raw) || !Array.isArray(raw.views)) {
    return { config: defaultViewConfig(), warnings: ['view config missing or malformed; using defaults'] };
  }

  const seen = new Set();
  const views = [];
  for (const entry of raw.views) {
    if (!isPlainObject(entry)) {
      warnings.push('dropped a non-object view entry');
      continue;
    }
    const id = typeof entry.id === 'string' ? entry.id : '';
    if (id === '') {
      warnings.push('dropped a view entry without id');
      continue;
    }
    if (!knownViewIds.includes(id)) {
      warnings.push(`unknown view "${id}" ignored`);
      continue;
    }
    if (seen.has(id)) {
      warnings.push(`duplicate view "${id}" ignored`);
      continue;
    }
    seen.add(id);
    const slot = typeof entry.slot === 'string' && knownSlots.includes(entry.slot) ? entry.slot : DEFAULT_SLOT;
    if (slot !== entry.slot) warnings.push(`unknown slot for view "${id}"; fell back to ${DEFAULT_SLOT}`);
    const order = Number.isFinite(entry.order) ? Math.trunc(Number(entry.order)) : 0;
    views.push({
      id,
      enabled: entry.enabled !== false,
      slot,
      order: Math.min(999, Math.max(-999, order)),
      config: sanitizeViewSettings(entry.config),
    });
  }

  return { config: { schemaVersion: VIEW_CONFIG_SCHEMA_VERSION, views }, warnings };
}

/**
 * Overlay a stored document onto the defaults without resurrecting Views the
 * user removed: the stored document is authoritative for `views`.
 *
 * @param {unknown} stored
 * @param {{knownViewIds?: readonly string[]}} [options]
 */
export function resolveViewConfig(stored, options) {
  if (stored === null || stored === undefined) {
    return { config: defaultViewConfig(), warnings: [] };
  }
  return normalizeViewConfig(stored, options);
}

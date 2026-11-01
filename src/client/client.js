/*
 * GENERATED FILE — edit src/client/core.js and src/client/views/*.js instead,
 * then run: node scripts/build-client.mjs
 */
/**
 * Client half — the browser bundle for `dsh-token-control`.
 *
 * Responsibilities, in order:
 *   1. subscribe to the Host's ViewModel (snapshot + SSE deltas),
 *   2. own the ViewRegistry and mount enabled Views into the slots the user chose,
 *   3. contribute one settings page that aggregates every View's own schema.
 *
 * It contains no token, price, balance, or calendar logic: those live on the
 * Host. It never imports provider/consumer modules and never reads `ctx` Host
 * services — only its own HTTP routes and the Client slot/locale services.
 *
 * Views are separate files under `views/` loaded as same-origin scripts listed
 * in `views/index.json`, so "add a View" is one new file plus one manifest line.
 */

window.__ModuleLoader__.load({
  id: 'dsh-token-control',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // ---------------------------------------------------------------------
    // Wire contract (mirrors src/definition/protocol.js; a unit test asserts
    // both copies agree, because a classic script cannot import that module).
    // ---------------------------------------------------------------------
    const PROTOCOL_VERSION = 1;
    const ROUTE_PREFIX = '/api/dsh-token-control/v1';
    const ROUTES = {
      snapshot: `${ROUTE_PREFIX}/snapshot`,
      stream: `${ROUTE_PREFIX}/stream`,
      viewConfig: `${ROUTE_PREFIX}/view-config`,
      balanceRefresh: `${ROUTE_PREFIX}/balance/refresh`,
      viewsManifest: `${ROUTE_PREFIX}/assets/views/index.json`,
      viewsAssetPrefix: `${ROUTE_PREFIX}/assets/views/`,
    };

    // ---------------------------------------------------------------------
    // Locale (small, self-contained: the Host sends semantic values, the View
    // renders words).
    // ---------------------------------------------------------------------
    const DICTS = {
      zh: {
        'slot.cell': 'Token 读数',
        'turn.label': '本轮',
        'turn.tokens': 'tok',
        'turn.cost': '金额',
        'turn.input': '入',
        'turn.output': '出',
        'turn.cacheHit': '命中',
        'turn.cacheMiss': '未命中',
        'turn.estimating': '估算中',
        'balance.label': '余额',
        'balance.stale': '已过期',
        'balance.unconfigured': '未配置 API Key',
        'balance.error': '不可用',
        'balance.minutes': '分钟前',
        'balance.now': '刚刚',
        'period.peak': '高峰',
        'period.idle': '空闲',
        'period.estimated': '按工作日估算',
        'period.toIdle': '后进入空闲',
        'period.toPeak': '后进入高峰',
        'period.switched': '已进入',
        'settings.title': 'Token 监控',
        'settings.views': '视图',
        'settings.enabled': '启用',
        'settings.slot': '挂载位置',
        'settings.save': '保存',
        'settings.saving': '保存中…',
        'settings.saved': '已保存',
        'settings.failed': '保存失败',
        'settings.warnings': '提示',
        'settings.empty': '尚未加载任何视图，请先确认客户端脚本已注册。',
        'settings.loading': '加载中…',
        'settings.interval': '余额刷新间隔（秒，15–3600）',
        'view.missing': 'Token 监控：视图脚本未加载',
        'view.failed': 'Token 监控：视图挂载失败',
      },
      en: {
        'slot.cell': 'Token readout',
        'turn.label': 'Turn',
        'turn.tokens': 'tok',
        'turn.cost': 'cost',
        'turn.input': 'in',
        'turn.output': 'out',
        'turn.cacheHit': 'cache hit',
        'turn.cacheMiss': 'cache miss',
        'turn.estimating': 'estimating',
        'balance.label': 'balance',
        'balance.stale': 'stale',
        'balance.unconfigured': 'no API key',
        'balance.error': 'unavailable',
        'balance.minutes': 'min ago',
        'balance.now': 'just now',
        'period.peak': 'Peak',
        'period.idle': 'Off-peak',
        'period.estimated': 'estimated by weekday',
        'period.toIdle': 'until off-peak',
        'period.toPeak': 'until peak',
        'period.switched': 'now',
        'settings.title': 'Token Monitor',
        'settings.views': 'Views',
        'settings.enabled': 'Enabled',
        'settings.slot': 'Slot',
        'settings.save': 'Save',
        'settings.saving': 'Saving…',
        'settings.saved': 'Saved',
        'settings.failed': 'Save failed',
        'settings.warnings': 'Notes',
        'settings.empty': 'No View is registered yet.',
        'settings.loading': 'Loading…',
        'settings.interval': 'Balance refresh interval (seconds, 15–3600)',
        'view.missing': 'Token monitor: view script not loaded',
        'view.failed': 'Token monitor: view failed to mount',
      },
    };

    /**
     * @param {any} ctx client context
     * @returns {(key:string, fallback:string) => string}
     */
    function makeLocale(ctx) {
      let active = 'en';
      try {
        // `ctx.get` never trips the service guard; a hard `ctx.locale` read would
        // require injecting the service just to render a label.
        const localeService = typeof ctx?.get === 'function' ? ctx.get('locale') : ctx?.locale;
        active = String(localeService?.getLocale?.()?.active ?? 'en');
      } catch {
        active = 'en';
      }
      const dict = active.toLowerCase().startsWith('zh') ? DICTS.zh : DICTS.en;
      return (key, fallback) => dict[key] ?? fallback;
    }

    // ---------------------------------------------------------------------
    // ViewModel store. Mirrors definition/view-model.js applyViewModelPatch:
    // unknown sections are kept, known objects are shallow-merged, absent
    // fields never throw.
    // ---------------------------------------------------------------------
    function createStore() {
      let current = null;
      const listeners = new Set();

      const notify = () => {
        for (const listener of listeners) {
          try {
            listener(current);
          } catch (error) {
            console.error('[dsh-token-control] view listener failed', error);
          }
        }
      };

      const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

      return {
        get: () => current,
        reset(next) {
          current = isPlainObject(next) ? next : null;
          notify();
        },
        patch(patch) {
          if (!isPlainObject(patch)) return;
          if (current === null) return;
          const next = { ...current };
          for (const [key, value] of Object.entries(patch)) {
            next[key] = isPlainObject(current[key]) && isPlainObject(value) ? { ...current[key], ...value } : value;
          }
          current = next;
          notify();
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      };
    }

    // ---------------------------------------------------------------------
    // Transport: one snapshot request, then a fetch-based SSE stream with
    // reconnect backoff. `EventSource` would not carry the same credentials.
    // ---------------------------------------------------------------------
    function createTransport(sessionId, store) {
      let closed = false;
      let controller = null;
      let retry = 0;
      let retryTimer = null;

      const query = `?sessionId=${encodeURIComponent(sessionId)}`;

      const handleEvent = (raw) => {
        let event = 'message';
        const dataLines = [];
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) return;
        let data;
        try {
          data = JSON.parse(dataLines.join('\n'));
        } catch {
          return;
        }
        if (event === 'reset' && data?.viewModel) store.reset(data.viewModel);
        else if (event === 'frame' && data?.patch) store.patch(data.patch);
      };

      const readStream = async (body) => {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          let index = buffer.indexOf('\n\n');
          while (index >= 0) {
            const raw = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            if (raw.trim() !== '' && !raw.trimStart().startsWith(':')) handleEvent(raw);
            index = buffer.indexOf('\n\n');
          }
        }
      };

      const openStream = async () => {
        if (closed) return;
        controller = new AbortController();
        try {
          const response = await fetch(`${ROUTES.stream}${query}`, {
            headers: { accept: 'text/event-stream' },
            signal: controller.signal,
            cache: 'no-store',
          });
          if (!response.ok || response.body === null) throw new Error(`stream ${response.status}`);
          retry = 0;
          await readStream(response.body);
        } catch {
          /* reconnect below */
        }
        if (closed) return;
        const delay = Math.min(15000, 500 * 2 ** Math.min(retry, 5));
        retry += 1;
        retryTimer = setTimeout(openStream, delay);
      };

      const start = async () => {
        try {
          const response = await fetch(`${ROUTES.snapshot}${query}`, {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          });
          if (response.ok) {
            const payload = await response.json();
            if (payload?.viewModel) store.reset(payload.viewModel);
          }
        } catch {
          /* the stream's reset will fill this in */
        }
        void openStream();
      };

      return {
        start,
        close() {
          closed = true;
          if (retryTimer !== null) clearTimeout(retryTimer);
          controller?.abort();
        },
      };
    }

    /** One shared store/transport per Session, reference counted by mounted Views. */
    function createSessionRuntimes() {
      const runtimes = new Map();
      return {
        acquire(sessionId) {
          let runtime = runtimes.get(sessionId);
          if (runtime === undefined) {
            const store = createStore();
            const transport = createTransport(sessionId, store);
            runtime = { store, transport, refs: 0 };
            runtimes.set(sessionId, runtime);
            void transport.start();
          }
          runtime.refs += 1;
          return runtime;
        },
        release(sessionId) {
          const runtime = runtimes.get(sessionId);
          if (runtime === undefined) return;
          runtime.refs -= 1;
          if (runtime.refs <= 0) {
            runtime.transport.close();
            runtimes.delete(sessionId);
          }
        },
        closeAll() {
          for (const runtime of runtimes.values()) runtime.transport.close();
          runtimes.clear();
        },
      };
    }

    // ---------------------------------------------------------------------
    // View registry. Views register themselves; the core only stores factories.
    // ---------------------------------------------------------------------
    function createRegistry() {
      /** @type {Map<string, Function>} */
      const factories = new Map();
      const listeners = new Set();
      const notify = () => {
        for (const listener of listeners) listener();
      };

      return {
        register(id, factory) {
          if (typeof id !== 'string' || id === '' || typeof factory !== 'function') return false;
          if (factories.has(id)) return false;
          factories.set(id, factory);
          notify();
          return true;
        },
        has: (id) => factories.has(id),
        ids: () => [...factories.keys()],
        create(id, deps) {
          const factory = factories.get(id);
          if (factory === undefined) return null;
          try {
            return factory(deps);
          } catch (error) {
            console.error(`[dsh-token-control] view "${id}" constructor failed`, error);
            return null;
          }
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    }

    // ---------------------------------------------------------------------
    // Shared style sheet for the settings page and hosts. Only theme tokens
    // with literal fallbacks: a renamed token degrades looks, never rendering.
    // ---------------------------------------------------------------------
    const STYLES = `
/* Slot entry geometry.
   The composer.dock list is a flex row whose entries each claim a width, so a
   percentage-minus-insets width collapses when sibling entries are mounted but
   empty (observed: every token on its own line). Claim a whole line instead and
   center a rail that is capped at the composer card width. */
.tm-host {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  /* Neutral on both axes: no flex-basis, so a column flex parent cannot turn
     this into a 100%-tall row. */
  flex: 0 0 auto;
  align-self: stretch;
  display: flex;
  justify-content: center;
}
.tm-rail {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: var(--dsh-composer-card-max-width, 100%);
  margin: 0 auto;
}
.tm-host .tm-mount { display: contents; }
.tm-missing { padding: 2px 12px 4px; font-size: 11px; color: var(--dsw-alias-state-error-primary, #b91c1c); }
.tm-bar {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px;
  padding: 4px 10px 2px; font-size: 11px; line-height: 1.6;
  color: var(--dsw-alias-text-2, #6b7280);
  font-variant-numeric: tabular-nums;
}
.tm-bar[data-compact="true"] { padding-top: 2px; padding-bottom: 0; }
.tm-bar .tm-strong { color: var(--dsw-alias-text-1, #111827); font-weight: 600; }
.tm-bar .tm-dim { opacity: .75; }
.tm-bar .tm-warn { color: var(--dsw-alias-warning, #b45309); }
.tm-bar .tm-bad { color: var(--dsw-alias-danger, #b91c1c); }
.tm-bar .tm-ok { color: var(--dsw-alias-success, #047857); }
.tm-bar .tm-dot { opacity: .45; }
.tm-settings { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px 24px; }
.tm-settings h3 { margin: 0; font-size: 14px; font-weight: 600; color: var(--dsw-alias-text-1, #111827); }
.tm-card { border: 1px solid var(--dsw-alias-border, #e5e7eb); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.tm-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--dsw-alias-text-2, #374151); }
.tm-row label { display: inline-flex; align-items: center; gap: 6px; }
.tm-row select, .tm-row input[type="number"], .tm-row input[type="text"] {
  font: inherit; padding: 2px 6px; border-radius: 6px; border: 1px solid var(--dsw-alias-border, #d1d5db);
  background: var(--dsw-alias-bg-1, #fff); color: var(--dsw-alias-text-1, #111827);
}
.tm-actions { display: flex; gap: 8px; align-items: center; }
.tm-actions button {
  font: inherit; font-size: 12px; padding: 4px 12px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border, #d1d5db); background: var(--dsw-alias-bg-1, #fff);
  color: var(--dsw-alias-text-1, #111827);
}
.tm-actions button[disabled] { opacity: .6; cursor: default; }
.tm-note { font-size: 11px; color: var(--dsw-alias-text-2, #6b7280); }
.tm-note.tm-bad { color: var(--dsw-alias-danger, #b91c1c); }
`;

    function Styles() {
      return h('style', { 'data-dsh-token-control': 'styles' }, STYLES);
    }

    // ---------------------------------------------------------------------
    // Plugin
    // ---------------------------------------------------------------------
    return {
      inject: ['slots'],
      name: 'dsh-token-control',

      apply(ctx) {
        const t = makeLocale(ctx);
        const registry = createRegistry();
        const sessions = createSessionRuntimes();

        /** Current layout assignments, replaced wholesale on config changes. */
        let assignments = [];
        /** @type {Array<() => void>} */
        let slotDisposers = [];
        let configDocument = { views: [], knownSlots: [], knownViews: [], warnings: [] };
        /** Bumped to remount View hosts after a layout change. */
        let layoutVersion = 0;
        const layoutListeners = new Set();
        const bumpLayout = () => {
          layoutVersion += 1;
          for (const listener of layoutListeners) listener();
        };

        // Views are inlined right here at build time (scripts/build-client.mjs),
        // so a View can never fail because of a page-global handshake, a dynamic
        // <script> element, or a load-order race. One IIFE per View runs against
        // the local registry below; the marker line is replaced by the builder.
        {
  // Views register through a hook that exists only for the duration of this
  // synchronous block, so two activations can never clobber each other.
  const host = {
    register(id, factory) {
      if (registry.register(id, factory)) bumpLayout();
    },
  };
  const previousHost = window.__DSH_TOKEN_CONTROL_VIEWS__;
  window.__DSH_TOKEN_CONTROL_VIEWS__ = host;
  try {
    /* ---- view: readout-bar (readout-bar.js) ---- */
    /**
     * ReadoutBar — the first View.
     *
     * A self-registering classic script: it needs no imports, receives React's
     * `createElement` from the registry, renders plain DOM, and subscribes to the
     * ViewModel through the `ViewContext` it is handed. It knows nothing about the
     * Host, the transport, or any other View.
     *
     * Adding a second View means: copy this file's shape into a new file, add one
     * manifest line in `views/index.json`. No Host change, no ViewModel change, no
     * change to this file.
     */
    (function () {
      'use strict';

      var registryHost = window.__DSH_TOKEN_CONTROL_VIEWS__;
      if (!registryHost || typeof registryHost.register !== 'function') {
        // The bundle exposes this hook before loading view scripts; reaching here
        // means the script was loaded out of band, so there is nothing to join.
        return;
      }

      /** @param {unknown} value @param {string} fallback */
      function text(value, fallback) {
        if (value === null || value === undefined || value === '') return fallback;
        return String(value);
      }

      /** @param {number} value */
      function count(value) {
        var n = Number(value);
        if (!isFinite(n)) return '0';
        return Math.round(n).toLocaleString('en-US');
      }

      /** @param {number} seconds */
      function clock(seconds) {
        var total = Math.max(0, Math.floor(seconds));
        var hh = Math.floor(total / 3600);
        var mm = Math.floor((total % 3600) / 60);
        var ss = total % 60;
        var mmText = mm < 10 ? '0' + mm : String(mm);
        var ssText = ss < 10 ? '0' + ss : String(ss);
        return hh > 0 ? hh + ':' + mmText + ':' + ssText : mmText + ':' + ssText;
      }

      var STYLE = [
        // The host rail (.tm-host) owns the width and centering; this only pads the
        // text to the composer card's content inset (12px, same as the shipped docks).
        '.tm-readout{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;',
        'padding:2px 12px 4px;font-size:11px;line-height:1.7;',
        'color:var(--dsw-alias-label-secondary,#6b7280);font-variant-numeric:tabular-nums;}',
        '.tm-readout[data-compact="true"]{padding:0 12px 2px;gap:0 6px;}',
        '.tm-readout .tm-sep{opacity:.35;}',
        '.tm-readout .tm-strong{color:var(--dsw-alias-label-primary,#111827);font-weight:600;}',
        '.tm-readout .tm-warn{color:var(--dsw-alias-state-warn-primary,#b45309);font-weight:600;}',
        '.tm-readout .tm-bad{color:var(--dsw-alias-state-error-primary,#b91c1c);}',
        '.tm-readout .tm-muted{opacity:.7;}',
        '.tm-readout [hidden]{display:none;}',
      ].join('');

      /**
       * @param {{ h: Function, React: any, locale: (key:string, fallback:string)=>string }} deps
       */
      function createReadoutBar(deps) {
        var t = deps.locale;

        var node = null;
        var styleNode = null;
        var containerRef = null;
        var unsubscribe = null;
        var timer = null;
        var config = {};
        var viewModel = null;
        var deadlineMs = 0;
        var lastKind = null;
        var flashUntil = 0;
        var flashText = '';

        var parts = {};

        function el(className, textContent) {
          var span = document.createElement('span');
          if (className) span.className = className;
          if (textContent !== undefined) span.textContent = textContent;
          return span;
        }

        function sep() {
          return el('tm-sep', '\u00b7');
        }

        function build(container) {
          styleNode = document.createElement('style');
          styleNode.setAttribute('data-dsh-token-control', 'readout-bar');
          styleNode.textContent = STYLE;
          container.appendChild(styleNode);

          node = document.createElement('div');
          node.className = 'tm-readout';
          node.setAttribute('role', 'status');
          node.setAttribute('aria-live', 'polite');
          node.setAttribute('aria-label', t('slot.cell', 'Token readout'));

          parts.turn = el('tm-turn');
          parts.sep1 = sep();
          parts.cost = el('tm-cost tm-strong');
          parts.sep2 = sep();
          parts.io = el('tm-io');
          parts.sep3 = sep();
          parts.cache = el('tm-cache');
          parts.sep4 = sep();
          parts.balance = el('tm-balance');
          parts.sep5 = sep();
          parts.period = el('tm-period tm-strong');
          parts.countdown = el('tm-countdown tm-muted');

          node.appendChild(parts.turn);
          node.appendChild(parts.sep1);
          node.appendChild(parts.cost);
          node.appendChild(parts.sep2);
          node.appendChild(parts.io);
          node.appendChild(parts.sep3);
          node.appendChild(parts.cache);
          node.appendChild(parts.sep4);
          node.appendChild(parts.balance);
          node.appendChild(parts.sep5);
          node.appendChild(parts.period);
          node.appendChild(parts.countdown);
          container.appendChild(node);
        }

        function show(element, visible) {
          if (element) element.hidden = visible !== true;
        }

        function render() {
          if (node === null) return;
          var vm = viewModel;
          var turn = (vm && vm.turn) || {};
          var tokens = turn.tokens || {};
          var cost = turn.cost || {};
          var balance = (vm && vm.balance) || {};
          var period = (vm && vm.period) || {};

          var decimals = Number.isFinite(Number(config.decimals)) ? Math.min(6, Math.max(2, Math.round(Number(config.decimals)))) : 4;
          var compact = config.compact === true;
          node.setAttribute('data-compact', compact ? 'true' : 'false');

          var estimated = tokens.estimated === true;
          var prefix = estimated ? '\u2248' : '';
          var costText = Number.isFinite(Number(cost.cny)) ? prefix + '\u00a5' + Number(cost.cny).toFixed(decimals) : prefix + '\u00a5\u2014';

          parts.turn.innerHTML = '';
          parts.turn.appendChild(document.createTextNode(t('turn.label', '\u672c\u8f6e') + ' '));
          var totalSpan = el('tm-strong', count(tokens.total));
          parts.turn.appendChild(totalSpan);
          parts.turn.appendChild(document.createTextNode(' ' + t('turn.tokens', 'tok')));
          if (estimated) {
            parts.turn.appendChild(document.createTextNode(' '));
            parts.turn.appendChild(el('tm-muted', '(' + t('turn.estimating', 'estimating') + ')'));
          }

          parts.cost.textContent = costText;

          parts.io.textContent =
            t('turn.input', 'in') + ' ' + count(tokens.input) + ' / ' + t('turn.output', 'out') + ' ' + count(tokens.output);

          var showCache = config.showCacheSplit !== false;
          show(parts.cache, showCache);
          show(parts.sep3, showCache);
          if (showCache) {
            parts.cache.textContent =
              t('turn.cacheHit', 'cache hit') + ' ' + count(tokens.cacheHit) + ' / ' +
              t('turn.cacheMiss', 'cache miss') + ' ' + count(tokens.cacheMiss);
          }

          var showBalance = config.showBalance !== false;
          show(parts.balance, showBalance);
          show(parts.sep4, showBalance);
          if (showBalance) {
            var balanceText;
            if (balance.state === 'unconfigured') {
              balanceText = t('balance.label', 'balance') + ' ' + t('balance.unconfigured', 'no API key');
              parts.balance.className = 'tm-balance tm-warn';
            } else if (balance.state === 'error' || balance.cny === null || balance.cny === undefined) {
              balanceText = t('balance.label', 'balance') + ' ' + t('balance.error', 'unavailable');
              parts.balance.className = 'tm-balance tm-bad';
            } else {
              balanceText = t('balance.label', 'balance') + ' \u00a5' + Number(balance.cny).toFixed(2);
              var staleSeconds = Number(balance.staleSeconds);
              if (balance.state === 'stale' && Number.isFinite(staleSeconds)) {
                balanceText += ' (' + t('balance.stale', 'stale') + ' ' + Math.max(1, Math.round(staleSeconds / 60)) + ' ' + t('balance.minutes', 'min ago') + ')';
                parts.balance.className = 'tm-balance tm-warn';
              } else if (Number.isFinite(staleSeconds) && staleSeconds >= 60) {
                balanceText += ' (' + Math.round(staleSeconds / 60) + ' ' + t('balance.minutes', 'min ago') + ')';
                parts.balance.className = 'tm-balance';
              } else {
                balanceText += ' (' + t('balance.now', 'just now') + ')';
                parts.balance.className = 'tm-balance';
              }
            }
            parts.balance.textContent = balanceText;
          }

          var kind = period.kind === 'peak' ? 'peak' : 'idle';
          var label = kind === 'peak' ? t('period.peak', 'Peak') : t('period.idle', 'Off-peak');
          var kindChanged = lastKind !== null && lastKind !== kind;
          lastKind = kind;
          if (kindChanged) {
            flashText = t('period.switched', 'now') + ' ' + label;
            flashUntil = Date.now() + 3000;
          }
          parts.period.textContent = Date.now() < flashUntil ? flashText : label;
          parts.period.className = kind === 'peak' ? 'tm-period tm-strong' : 'tm-period tm-strong';

          var periodNote = [];
          if (period.estimated === true) periodNote.push(t('period.estimated', 'estimated by weekday'));
          if (Date.now() < flashUntil) periodNote.push('\u00b7');
          var upcoming = period.upcoming === 'peak' ? t('period.toPeak', 'until peak') : t('period.toIdle', 'until off-peak');
          parts.countdown.textContent = '';
          if (config.showCountdown !== false) {
            var next = Number(period.nextTransitionAt);
            if (Number.isFinite(next) && next > 0) {
              deadlineMs = next + clockSkew(period);
              parts.countdown.textContent = upcoming + ' ' + clock((deadlineMs - Date.now()) / 1000);
              parts.countdown.className = Number(period.remainingSeconds) <= 300 ? 'tm-countdown tm-warn' : 'tm-countdown tm-muted';
            } else {
              parts.countdown.textContent = '';
            }
          }
          if (periodNote.length > 0) {
            parts.countdown.textContent = parts.countdown.textContent
              ? parts.countdown.textContent + ' \u00b7 ' + periodNote.join(' ')
              : periodNote.join(' ');
          }
        }

        /** Align the Host's clock with the browser's without trusting either. */
        function clockSkew(period) {
          var hostTime = viewModel && viewModel.meta ? Number(viewModel.meta.hostTime) : NaN;
          var transition = Number(period.nextTransitionAt);
          if (!isFinite(hostTime) || !isFinite(transition)) return 0;
          return Date.now() - hostTime;
        }

        function tick() {
          if (node === null || config.showCountdown === false) return;
          var remaining = (deadlineMs - Date.now()) / 1000;
          if (!isFinite(remaining)) return;
          var period = (viewModel && viewModel.period) || {};
          var upcoming = period.upcoming === 'peak' ? t('period.toPeak', 'until peak') : t('period.toIdle', 'until off-peak');
          var suffix = Date.now() < flashUntil ? ' \u00b7 ' + flashText : '';
          if (remaining <= 0) {
            parts.countdown.textContent = upcoming + ' ' + clock(0) + suffix;
          } else {
            parts.countdown.textContent = upcoming + ' ' + clock(remaining) + suffix;
            parts.countdown.className = remaining <= 300 ? 'tm-countdown tm-warn' : 'tm-countdown tm-muted';
          }
        }

        return {
          id: 'readout-bar',
          label: '\u8bfb\u6570\u5e26',

          mount: function (container, context) {
            if (containerRef !== null) return;
            containerRef = container;
            config = context.getConfig();
            viewModel = context.getSnapshot();
            build(container);

            unsubscribe = context.subscribe(function (next) {
              viewModel = next;
              render();
            });

            render();
            timer = setInterval(tick, 1000);
          },

          unmount: function () {
            if (timer !== null) clearInterval(timer);
            timer = null;
            if (typeof unsubscribe === 'function') unsubscribe();
            unsubscribe = null;
            if (node !== null && node.parentNode !== null) node.parentNode.removeChild(node);
            if (styleNode !== null && styleNode.parentNode !== null) styleNode.parentNode.removeChild(styleNode);
            node = null;
            styleNode = null;
            containerRef = null;
            parts = {};
            viewModel = null;
            lastKind = null;
          },

          update: function (next) {
            viewModel = next;
            render();
          },

          getConfigSchema: function () {
            return {
              type: 'object',
              properties: {
                compact: { type: 'boolean', title: '\u7d27\u51d1\u5355\u884c', default: false },
                showBalance: { type: 'boolean', title: '\u663e\u793a\u4f59\u989d', default: true },
                showCacheSplit: { type: 'boolean', title: '\u663e\u793a\u7f13\u5b58\u547d\u4e2d/\u672a\u547d\u4e2d', default: true },
                showCountdown: { type: 'boolean', title: '\u663e\u793a\u5207\u6362\u5012\u8ba1\u65f6', default: true },
                decimals: { type: 'number', title: '\u91d1\u989d\u5c0f\u6570\u4f4d', minimum: 2, maximum: 6, default: 4 },
              },
            };
          },

          supportedSlots: function () {
            return ['conversation.input.dock', 'conversation.composer.dock'];
          },
        };
      }

      registryHost.register('readout-bar', createReadoutBar);
    })();
  } finally {
    if (window.__DSH_TOKEN_CONTROL_VIEWS__ === host) {
      if (previousHost === undefined) delete window.__DSH_TOKEN_CONTROL_VIEWS__;
      else window.__DSH_TOKEN_CONTROL_VIEWS__ = previousHost;
    }
  }
}

        // One owner for everything the async bootstrap registers. Slot
        // registrations deliberately live here so a layout change or an unload
        // cannot leak them.
        ctx.effect(
          () => () => {
            for (const dispose of slotDisposers) {
              try {
                dispose();
              } catch {
                /* already disposed */
              }
            }
            slotDisposers = [];
            sessions.closeAll();
          },
          'token-control: client teardown',
        );

        // ---- data ---------------------------------------------------------
        const fetchJson = async (url, init) => {
          const response = await fetch(url, { cache: 'no-store', ...init });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return await response.json();
        };

        // Used when the Host cannot be reached at all: an empty layout would make
        // the whole feature invisible, which is worse than a default placement.
        const FALLBACK_SLOTS = ['conversation.input.dock', 'conversation.composer.dock', 'conversation.composer.bar'];
        const fallbackDocument = () => ({
          protocolVersion: 1,
          schemaVersion: 1,
          views: [{ id: 'readout-bar', enabled: true, slot: 'conversation.input.dock', order: 25, config: {} }],
          knownSlots: FALLBACK_SLOTS,
          knownViews: [{ id: 'readout-bar', label: '读数带' }],
          warnings: ['view config unavailable; using the built-in layout'],
        });

        const refreshViewConfig = async () => {
          try {
            configDocument = await fetchJson(ROUTES.viewConfig);
          } catch (error) {
            console.error('[dsh-token-control] view-config unavailable; keeping the built-in layout', error);
            if (!Array.isArray(configDocument?.views) || configDocument.views.length === 0) {
              configDocument = fallbackDocument();
            }
          }
          return configDocument;
        };

        const applyAssignments = () => {
          for (const dispose of slotDisposers) {
            try {
              dispose();
            } catch {
              /* already disposed */
            }
          }
          slotDisposers = [];

          for (const view of configDocument.views ?? []) {
            if (view.enabled === false) continue;
            // Deliberately NOT gated on `registry.has(view.id)`: registering the
            // slot anyway lets the placeholder appear (and the View mount as soon
            // as its script finishes loading) instead of failing silently.
            try {
              const dispose = ctx.slots.inject(view.slot, () =>
                ctx.slots.register(
                  { name: view.slot, id: `token-control:${view.id}`, order: view.order ?? 25 },
                  makeSlotHost(view),
                ),
              );
              slotDisposers.push(dispose);
            } catch (error) {
              console.error(`[dsh-token-control] failed to mount view "${view.id}" into "${view.slot}"`, error);
            }
          }
          console.info(
            '[dsh-token-control] layout applied',
            (configDocument.views ?? []).map((view) => `${view.id}@${view.slot}`),
            'registered views:',
            registry.ids(),
          );
          bumpLayout();
        };

        // ---- view host ----------------------------------------------------
        const makeSlotHost = (viewAssignment) => {
          const viewId = viewAssignment.id;
          return function TokenMonitorSlotHost(props) {
            const sessionId = props?.sessionId ?? props?.session?.id ?? null;
            const [registryVersion, force] = React.useState(0);

            React.useEffect(() => {
              const offRegistry = registry.subscribe(() => force((n) => n + 1));
              const offLayout = layoutListeners.add(() => force((n) => n + 1));
              return () => {
                offRegistry();
                layoutListeners.delete(offLayout);
              };
            }, []);

            return h(ViewHost, {
              key: `${viewId}:${registryVersion}:${sessionId ?? 'none'}`,
              viewId,
              sessionId,
              assignment: viewAssignment,
              t,
            });
          };
        };

        function ViewHost({ viewId, sessionId, assignment, t }) {
          const container = React.useRef(null);
          const [state, setState] = React.useState({ kind: 'pending' });

          React.useEffect(() => {
            if (container.current === null) return undefined;
            if (typeof sessionId !== 'string' || sessionId === '') {
              setState({ kind: 'no-session' });
              return undefined;
            }

            const view = registry.create(viewId, { h, React, locale: t });
            if (view === null) {
              console.warn(`[dsh-token-control] view "${viewId}" is not registered yet`);
              setState({ kind: 'missing' });
              return undefined;
            }

            const runtime = sessions.acquire(sessionId);
            const instance = {
              update(viewModel) {
                try {
                  view.update(viewModel);
                } catch (error) {
                  console.error(`[dsh-token-control] view "${viewId}" update failed`, error);
                }
              },
            };

            const viewContext = {
              getSnapshot: () => runtime.store.get(),
              subscribe(listener) {
                let last = null;
                return runtime.store.subscribe((viewModel) => {
                  if (viewModel === last) return;
                  last = viewModel;
                  try {
                    listener(viewModel);
                  } catch (error) {
                    console.error(`[dsh-token-control] view "${viewId}" listener failed`, error);
                  }
                });
              },
              getConfig: () => ({ ...(assignment.config ?? {}) }),
              patchConfig(patch) {
                void saveViewConfig((current) => ({
                  ...current,
                  views: current.views.map((entry) =>
                    entry.id === viewId ? { ...entry, config: { ...entry.config, ...patch } } : entry,
                  ),
                }));
              },
              locale: t,
            };

            try {
              view.mount(container.current, viewContext);
            } catch (error) {
              console.error(`[dsh-token-control] view "${viewId}" mount failed`, error);
              sessions.release(sessionId);
              setState({ kind: 'failed' });
              return undefined;
            }
            setState({ kind: 'mounted' });

            const unsubscribe = viewContext.subscribe((viewModel) => instance.update(viewModel));
            const initial = runtime.store.get();
            if (initial !== null) instance.update(initial);

            return () => {
              unsubscribe();
              try {
                view.unmount();
              } catch (error) {
                console.error(`[dsh-token-control] view "${viewId}" unmount failed`, error);
              }
              sessions.release(sessionId);
            };
            // `assignment` identity changes on every layout apply, which is the
            // signal to remount with the new config.
          }, [viewId, sessionId, assignment, t]);

          const hint =
            state.kind === 'missing'
              ? t('view.missing', 'Token monitor: view script not loaded')
              : state.kind === 'failed'
                ? t('view.failed', 'Token monitor: view failed to mount')
                : null;

          return h(
            'div',
            { className: 'tm-host', 'data-token-control': viewId },
            // The rail style is component-local, so an unmount removes it.
            h(Styles),
            h(
              'div',
              { className: 'tm-rail' },
              h('div', { className: 'tm-mount', ref: container }),
              hint === null ? null : h('div', { className: 'tm-missing', role: 'status' }, hint),
            ),
          );
        }

        // ---- persistence --------------------------------------------------
        let saveChain = Promise.resolve();

        const saveViewConfig = (mutate) => {
          saveChain = saveChain
            .then(async () => {
              const current = await refreshViewConfig();
              const draft = mutate({
                views: [...(current.views ?? [])],
                knownSlots: current.knownSlots ?? [],
              });
              const saved = await fetchJson(ROUTES.viewConfig, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ views: draft.views }),
              });
              configDocument = saved;
              applyAssignments();
              return saved;
            })
            .catch((error) => {
              console.error('[dsh-token-control] saving the view layout failed', error);
              return null;
            });
          return saveChain;
        };

        // ---- settings page ------------------------------------------------
        function SettingsPage() {
          const [documentValue, setDocumentValue] = React.useState(null);
          const [status, setStatus] = React.useState('idle');
          const [draft, setDraft] = React.useState([]);
          const [warnings, setWarnings] = React.useState([]);

          React.useEffect(() => {
            let cancelled = false;
            void (async () => {
              const config = await refreshViewConfig();
              if (cancelled) return;
              setDocumentValue(config);
              setDraft(config.views ?? []);
              setWarnings(Array.isArray(config.warnings) ? config.warnings : []);
            })();
            return () => {
              cancelled = true;
            };
          }, []);

          const knownSlots = documentValue?.knownSlots ?? ['conversation.input.dock'];
          const knownViews = documentValue?.knownViews ?? [];

          const patchDraft = (viewId, change) => {
            setDraft((rows) => rows.map((row) => (row.id === viewId ? { ...row, ...change } : row)));
          };

          const save = async () => {
            setStatus('saving');
            try {
              const saved = await fetchJson(ROUTES.viewConfig, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ views: draft }),
              });
              configDocument = saved;
              setDocumentValue(saved);
              setWarnings(Array.isArray(saved.warnings) ? saved.warnings : []);
              setStatus('saved');
              applyAssignments();
            } catch (error) {
              console.error('[dsh-token-control] settings save failed', error);
              setStatus('failed');
            }
          };

          if (documentValue === null) {
            return h('div', { className: 'tm-settings' }, h(Styles, null), h('div', { className: 'tm-note' }, t('settings.loading', 'Loading…')));
          }

          return h(
            'div',
            { className: 'tm-settings' },
            h(Styles, null),
            h('h3', null, t('settings.title', 'Token Monitor')),
            knownViews.length === 0
              ? h('div', { className: 'tm-note' }, t('settings.empty', 'No View is registered yet.'))
              : null,
            ...knownViews.map((view) => {
              const row = draft.find((entry) => entry.id === view.id) ?? {
                id: view.id,
                enabled: false,
                slot: knownSlots[0],
                order: 0,
                config: {},
              };
              const factory = registry.create(view.id, { h, React, locale: t });
              let schema = null;
              let slots = [];
              let label = view.label ?? view.id;
              if (factory !== null) {
                try {
                  label = factory.label ?? label;
                  schema = factory.getConfigSchema?.() ?? null;
                  slots = factory.supportedSlots?.() ?? [];
                  factory.unmount?.();
                } catch (error) {
                  console.error(`[dsh-token-control] view "${view.id}" schema failed`, error);
                }
              }
              const availableSlots = slots.filter((slot) => knownSlots.includes(slot));
              const properties = schema?.properties ?? {};

              return h(
                'div',
                { className: 'tm-card', key: view.id },
                h(
                  'div',
                  { className: 'tm-row' },
                  h(
                    'label',
                    null,
                    h('input', {
                      type: 'checkbox',
                      checked: row.enabled !== false,
                      onChange: (event) => patchDraft(view.id, { enabled: event.target.checked }),
                    }),
                    `${t('settings.enabled', 'Enabled')} · ${label}`,
                  ),
                ),
                availableSlots.length === 0
                  ? null
                  : h(
                      'div',
                      { className: 'tm-row' },
                      h('span', null, t('settings.slot', 'Slot')),
                      h(
                        'select',
                        {
                          value: row.slot,
                          onChange: (event) => patchDraft(view.id, { slot: event.target.value }),
                        },
                        ...availableSlots.map((slot) => h('option', { key: slot, value: slot }, slot)),
                      ),
                    ),
                ...Object.entries(properties).map(([key, field]) => {
                  const value = row.config?.[key] ?? field.default;
                  if (field.type === 'boolean') {
                    return h(
                      'div',
                      { className: 'tm-row', key: `${view.id}:${key}` },
                      h(
                        'label',
                        null,
                        h('input', {
                          type: 'checkbox',
                          checked: value === true,
                          onChange: (event) =>
                            patchDraft(view.id, { config: { ...(row.config ?? {}), [key]: event.target.checked } }),
                        }),
                        field.title ?? key,
                      ),
                    );
                  }
                  if (field.type === 'number') {
                    return h(
                      'div',
                      { className: 'tm-row', key: `${view.id}:${key}` },
                      h('span', null, field.title ?? key),
                      h('input', {
                        type: 'number',
                        value,
                        min: field.minimum,
                        max: field.maximum,
                        onChange: (event) => {
                          const parsed = Number(event.target.value);
                          if (!Number.isFinite(parsed)) return;
                          patchDraft(view.id, { config: { ...(row.config ?? {}), [key]: parsed } });
                        },
                      }),
                    );
                  }
                  return null;
                }),
              );
            }),
            warnings.length === 0
              ? null
              : h(
                  'div',
                  { className: 'tm-note' },
                  `${t('settings.warnings', 'Notes')}: ${warnings.join(' · ')}`,
                ),
            h(
              'div',
              { className: 'tm-actions' },
              h(
                'button',
                { type: 'button', disabled: status === 'saving', onClick: () => void save() },
                status === 'saving' ? t('settings.saving', 'Saving…') : t('settings.save', 'Save'),
              ),
              status === 'saved' ? h('span', { className: 'tm-note' }, t('settings.saved', 'Saved')) : null,
              status === 'failed'
                ? h('span', { className: 'tm-note tm-bad' }, t('settings.failed', 'Save failed'))
                : null,
            ),
            h('div', { className: 'tm-note' }, t('settings.interval', 'Balance refresh interval (seconds, 15–3600)')),
          );
        }

        // Settings page is registered synchronously; it loads its own data.
        ctx.effect(
          () =>
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register(
                { name: 'settings.section', id: 'dsh-token-control', order: 27, label: () => t('settings.title', 'Token Monitor') },
                SettingsPage,
              ),
            ),
          'token-control: settings section',
        );

        // ---- bootstrap ----------------------------------------------------
        console.info('[dsh-token-control] registered views:', registry.ids());
        void (async () => {
          await refreshViewConfig();
          console.info(
            '[dsh-token-control] client ready',
            'registered:',
            registry.ids(),
            'layout:',
            (configDocument.views ?? []).map((view) => `${view.id}@${view.slot}`),
          );
          applyAssignments();
        })();
      },
    };
  },
});

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

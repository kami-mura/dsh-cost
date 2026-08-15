// dsh-cost-log —— Client bundle（手写，无构建步骤）
// 格式与 tsdown clientBundle 产物一致：CJS 闭包注册到 window.__ModuleLoader__，
// 工厂通过注入的 require 从 loader 模块表解析外部依赖（react 与
// @deepseek-ai/dsh-client-ui-primitives 都是 web 平台模块）。
//
// UI：注册在 ui-conversation 的 `conversation.input.right` 插槽 ——
// 输入框卡片工具行右端、模型选择器左边，始终贴着输入区。金额读取 Host
// 注册的 durable 会话投影 `costLog`，不访问外部站点。
// 同时在 DSH 设置 > 插件 > Plugin configuration 注册费用货币选择。
// 悬浮提示文案通过 locale 服务与系统语言保持一致。

window.__ModuleLoader__.load({ id: 'dsh-cost-log', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
var React = require('react');
var Tooltip = require('@deepseek-ai/dsh-client-ui-primitives').Tooltip;

var NS = 'costLog';
var EFFECTIVE_AT_MS = Date.UTC(2026, 7, 16, 16, 0, 0); // 北京 2026-08-17 00:00
var BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
var DEFAULT_CURRENCY = 'CNY';
var CURRENCIES = ['CNY', 'USD'];

var DICT_ZH = {
  'costBadge': '对话花费',
  'input': '输入',
  'output': '输出',
  'miss': '未命中',
  'hit': '命中',
  'write': '写入',
  'noTokens': '当前对话还没有 token 用量',
  'model': '模型',
  'latestRate': '最近一次计价',
  'legacy': '旧价格表',
  'peak': '高峰时段',
  'offpeak': '空闲时段',
  'currentLegacy': '当前：旧价格表（新表 2026-08-17 00:00 北京时间生效）',
  'currentNew': '当前：新价格表',
  'incomplete': '注意：包含未按本价格表计价的模型调用，金额仅为可计价部分',
  'rateHit': '命中',
  'rateMiss': '未命中',
  'rateOutput': '输出',
  'inputTokens': '输入 tokens',
  'outputTokens': '输出 tokens',
  'flashCost': 'flash 花费',
  'proCost': 'pro 花费',
  'settings.title': '费用货币',
  'settings.description': '选择费用徽标与明细中使用的货币',
  'currency.CNY': '人民币 (CNY)',
  'currency.USD': '美元 (USD)',
};

var DICT_EN = {
  'costBadge': 'Conversation cost',
  'input': 'Input',
  'output': 'Output',
  'miss': 'miss',
  'hit': 'hit',
  'write': 'write',
  'noTokens': 'No token usage in this conversation yet',
  'model': 'Model',
  'latestRate': 'Latest pricing',
  'legacy': 'Legacy pricing',
  'peak': 'Peak hours',
  'offpeak': 'Off-peak hours',
  'currentLegacy': 'Current: legacy pricing (new pricing effective 2026-08-17 00:00 Beijing time)',
  'currentNew': 'Current: new pricing',
  'incomplete': 'Note: includes model calls not priced by this table; amount only covers priced portion',
  'rateHit': 'hit',
  'rateMiss': 'miss',
  'rateOutput': 'output',
  'inputTokens': 'Input tokens',
  'outputTokens': 'Output tokens',
  'flashCost': 'flash cost',
  'proCost': 'pro cost',
  'settings.title': 'Cost currency',
  'settings.description': 'Choose the currency used in the cost badge and details',
  'currency.CNY': 'CNY',
  'currency.USD': 'USD',
};

var CSS =
  '.dcl-root{display:inline-flex;align-items:center;justify-content:center;height:24px;padding:0 8px;border:1px solid var(--dsw-static-deepseek-500,#4D6BFE);border-radius:12px;background:var(--dsw-static-deepseek-500,#4D6BFE);color:#fff;font-family:var(--dsw-font-family);font-size:12px;line-height:18px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;box-sizing:border-box;cursor:default;gap:5px}' +
  '.dcl-root .dcl-amount{color:#fff}' +
  '.dcl-root[data-complete="false"] .dcl-amount{color:rgba(255,255,255,.9)}' +
  '.dcl-root .dcl-dot{width:5px;height:5px;border-radius:50%;background:#fff;animation:dcl-pulse 1.2s ease-in-out infinite}' +
  '@keyframes dcl-pulse{0%,100%{opacity:.3}50%{opacity:1}}' +
  '@media (prefers-reduced-motion:reduce){.dcl-root .dcl-dot{animation:none}}' +
  '.dcl-settings-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#eee)}' +
  '.dcl-settings-text{display:flex;flex-direction:column;gap:4px;min-width:0}' +
  '.dcl-settings-title{color:var(--dsw-alias-label-primary,#1f2329);font-size:14px;line-height:22px}' +
  '.dcl-settings-desc{color:var(--dsw-alias-label-tertiary,#6b7280);font-size:12px;line-height:18px}' +
  '.dcl-settings-select{background:var(--dsw-alias-bg-module-platform,#fff);height:36px;font:inherit;color:var(--dsw-alias-label-primary,#1f2329);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:18px;padding:0 14px;font-size:14px;line-height:22px;cursor:pointer}' +
  '.dcl-plugin-card{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:12px;padding:16px;background:var(--dsw-alias-bg-module-platform,#fff)}' +
  '.dcl-plugin-card-header{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}' +
  '.dcl-plugin-card-title{color:var(--dsw-alias-label-primary,#1f2329);font-size:14px;line-height:22px}' +
  '.dcl-plugin-card-desc{color:var(--dsw-alias-label-tertiary,#6b7280);font-size:12px;line-height:18px}' +
  '.dcl-plugin-card-select{background:var(--dsw-alias-bg-module-platform,#fff);height:36px;font:inherit;color:var(--dsw-alias-label-primary,#1f2329);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:18px;padding:0 14px;font-size:14px;line-height:22px;cursor:pointer}';

function formatTokens(n) {
  var value = Number(n) || 0;
  var scaled = function (v) {
    return v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  };
  if (value < 1000) return String(Math.round(value));
  if (value < 1000000) return scaled(value / 1000) + 'K';
  return scaled(value / 1000000) + 'M';
}

function currencySymbol(currency) {
  return currency === 'USD' ? '$' : '¥';
}

function formatCost(n, currency) {
  var value = Number(n);
  var symbol = currencySymbol(currency);
  if (!Number.isFinite(value) || value < 0) return symbol + '—';
  if (value === 0) return symbol + '0';
  if (value < 0.01) return '<' + symbol + '0.01';
  return symbol + (Math.round(value * 100) / 100).toFixed(2);
}

function beijingMinutes(ms) {
  var shifted = new Date(ms + BEIJING_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

function isPeakAt(ms) {
  var minutes = beijingMinutes(ms);
  return (minutes >= 9 * 60 && minutes < 12 * 60)
    || (minutes >= 14 * 60 && minutes < 18 * 60);
}

function currentTierLabel(now, t) {
  if (now < EFFECTIVE_AT_MS) return t('currentLegacy');
  return t('currentNew') + ' · ' + (isPeakAt(now) ? t('peak') : t('offpeak'));
}

function rateName(rate, t) {
  if (rate.mode === 'legacy') return t('legacy');
  if (rate.mode === 'peak') return t('peak');
  return t('offpeak');
}

function rateDetail(rate, currency, t) {
  var symbol = currencySymbol(currency);
  return t('rateHit') + ' ' + symbol + rate.inputHit + '/M · ' +
    t('rateMiss') + ' ' + symbol + rate.inputMiss + '/M · ' +
    t('rateOutput') + ' ' + symbol + rate.output + '/M';
}

function buildTooltip(value, now, t, currency) {
  var tokens = value.tokens || {};
  var byModel = value.byModel || [];
  var flashCost = 0;
  var proCost = 0;
  for (var i = 0; i < byModel.length; i++) {
    var model = String(byModel[i].model || '').toLowerCase();
    var cost = currency === 'USD' ? (Number(byModel[i].costUsd) || 0) : (Number(byModel[i].cost) || 0);
    if (model.indexOf('v4-flash') !== -1) flashCost += cost;
    else if (model.indexOf('v4-pro') !== -1) proCost += cost;
  }
  return [
    t('inputTokens') + ' ' + formatTokens(tokens.inputTokens),
    t('outputTokens') + ' ' + formatTokens(tokens.outputTokens),
    t('flashCost') + ' ' + formatCost(flashCost, currency),
    t('proCost') + ' ' + formatCost(proCost, currency),
  ].join('\n');
}

function createSnapshotStore(initial) {
  var value = initial;
  var listeners = new Set();
  return {
    getSnapshot: function () { return value; },
    subscribe: function (listener) {
      listeners.add(listener);
      return function () { listeners.delete(listener); };
    },
    set: function (next) {
      if (value === next) return;
      value = next;
      listeners.forEach(function (listener) { listener(); });
    },
  };
}

function CostBadge(props) {
  var value = props.useProjection('costLog');
  var running = props.useSession(function (snapshot) { return snapshot.running; });
  var useCurrency = props.useCurrency || function () { return DEFAULT_CURRENCY; };
  var currency = useCurrency(function (v) { return v; }) || DEFAULT_CURRENCY;
  var t = props.t || function (key) { return DICT_ZH[key] || key; };
  if (value === undefined) return null;

  var complete = value.complete !== false;
  var amount = currency === 'USD' ? (Number(value.costUsd) || 0) : (Number(value.cost) || 0);
  var amountText = formatCost(amount, currency);
  if (!complete && amount > 0) amountText = '≈' + amountText;
  else if (!complete) amountText = (currency === 'USD' ? '$0+' : '¥0+');
  var summary = buildTooltip(value, Date.now(), t, currency);

  return React.createElement(
    Tooltip,
    {
      label: function () { return buildTooltip(value, Date.now(), t, currency); },
      side: 'top',
      delayMs: 450,
      maxWidth: 360,
    },
    React.createElement(
      'div',
      {
        className: 'dcl-root',
        'data-complete': complete ? 'true' : 'false',
        'aria-label': summary,
      },
      React.createElement('span', { className: 'dcl-amount' }, amountText),
      running ? React.createElement('span', { className: 'dcl-dot', 'aria-hidden': true }) : null,
    ),
  );
}

function CurrencyCard(props) {
  var t = props.t || function (key) { return DICT_ZH[key] || key; };
  var useCurrency = props.useCurrency || function () { return DEFAULT_CURRENCY; };
  var currency = useCurrency(function (v) { return v; }) || DEFAULT_CURRENCY;
  var setCurrency = props.setCurrency || function () {};

  return React.createElement(
    'li',
    { className: 'dcl-plugin-card' },
    React.createElement(
      'div',
      { className: 'dcl-plugin-card-header' },
      React.createElement('div', { className: 'dcl-plugin-card-title' }, t('settings.title')),
      React.createElement('div', { className: 'dcl-plugin-card-desc' }, t('settings.description')),
    ),
    React.createElement(
      'select',
      {
        className: 'dcl-plugin-card-select',
        value: currency,
        'aria-label': t('settings.title'),
        onChange: function (event) { setCurrency(event.target.value); },
      },
      CURRENCIES.map(function (id) {
        return React.createElement('option', { key: id, value: id }, t('currency.' + id));
      }),
    ),
  );
}

function apply(ctx) {
  var slots = ctx.get('slots');
  if (slots === undefined) return;
  var style = document.createElement('style');
  style.dataset.plugin = 'dsh-cost-log';
  style.textContent = CSS;
  document.head.appendChild(style);
  ctx.effect(function () {
    return function () {
      if (style.parentNode) style.parentNode.removeChild(style);
    };
  });

  var locale = ctx.get('locale');
  if (locale !== undefined) {
    ctx.effect(function () {
      return locale.register(NS, { zh: DICT_ZH, en: DICT_EN });
    }, 'cost-log: dictionaries');
  }

  var currencyStore = createSnapshotStore(DEFAULT_CURRENCY);
  var settingsScope = ctx.get('settingsScope');
  var host;
  if (settingsScope !== undefined && ctx.get('connection') !== undefined && ctx.get('remote') !== undefined) {
    try {
      host = settingsScope.bind({ namespace: 'cost-log' });
      var adopt = function () {
        var section = host.getSnapshot().value;
        if (section && (section.currency === 'CNY' || section.currency === 'USD')) {
          currencyStore.set(section.currency);
        }
      };
      host.subscribe(adopt);
      adopt();
    } catch (_) {
      host = undefined;
    }
  }
  var setCurrency = function (currency) {
    if (CURRENCIES.indexOf(currency) === -1) return;
    if (currencyStore.getSnapshot() !== currency) currencyStore.set(currency);
    if (host !== undefined) host.set('currency', currency);
  };

  // 输入框卡片内、工具行右侧：位于模型选择器左侧，紧贴发送区。
  slots.inject('conversation.input.right', function () {
    var options = {
      name: 'conversation.input.right',
      id: 'cost-log',
      order: 40,
      label: locale !== undefined ? function () { return locale.bind(NS)('costBadge'); } : '对话花费',
      inject: function () {
        return { hooks: { currency: currencyStore } };
      },
    };
    if (locale !== undefined) options.locale = NS;
    return slots.register(options, CostBadge);
  });

  // DSH 设置 > 插件 > Plugin configuration：费用货币选择。
  slots.inject('settings.plugin.item', function () {
    var options = {
      name: 'settings.plugin.item',
      id: 'cost-log-currency',
      order: 30,
      inject: function () {
        return {
          hooks: { currency: currencyStore },
          setCurrency: setCurrency,
        };
      },
    };
    if (locale !== undefined) options.locale = NS;
    return slots.register(options, CurrencyCard);
  });
}

module.exports = { name: 'cost-log', inject: ['slots'], apply: apply };
return module.exports; } });

// dsh-cost-log —— Client bundle（手写，无构建步骤）
// 格式与 tsdown clientBundle 产物一致：CJS 闭包注册到 window.__ModuleLoader__，
// 工厂通过注入的 require 从 loader 模块表解析外部依赖（react 与
// @deepseek-ai/dsh-client-ui-primitives 都是 web 平台模块）。
//
// UI：注册在 ui-conversation 的 `conversation.input.right` 插槽 ——
// 输入框卡片工具行右端、模型选择器左边，始终贴着输入区。金额读取 Host
// 注册的 durable 会话投影 `costLog`，不访问外部站点。

window.__ModuleLoader__.load({ id: 'dsh-cost-log', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
var React = require('react');
var Tooltip = require('@deepseek-ai/dsh-client-ui-primitives').Tooltip;

var EFFECTIVE_AT_MS = Date.UTC(2026, 7, 16, 16, 0, 0); // 北京 2026-08-17 00:00
var BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

var CSS =
  '.dcl-root{display:inline-flex;align-items:center;justify-content:center;height:24px;padding:0 8px;border:1px solid var(--dsw-static-deepseek-500,#4D6BFE);border-radius:12px;background:var(--dsw-static-deepseek-500,#4D6BFE);color:#fff;font-family:var(--dsw-font-family);font-size:12px;line-height:18px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;box-sizing:border-box;cursor:default;gap:5px}' +
  '.dcl-root .dcl-amount{color:#fff}' +
  '.dcl-root[data-complete="false"] .dcl-amount{color:rgba(255,255,255,.9)}' +
  '.dcl-root .dcl-dot{width:5px;height:5px;border-radius:50%;background:#fff;animation:dcl-pulse 1.2s ease-in-out infinite}' +
  '@keyframes dcl-pulse{0%,100%{opacity:.3}50%{opacity:1}}' +
  '@media (prefers-reduced-motion:reduce){.dcl-root .dcl-dot{animation:none}}';

function formatTokens(n) {
  var value = Number(n) || 0;
  var scaled = function (v) {
    return v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  };
  if (value < 1000) return String(Math.round(value));
  if (value < 1000000) return scaled(value / 1000) + 'K';
  return scaled(value / 1000000) + 'M';
}

function formatCost(n) {
  var value = Number(n);
  if (!Number.isFinite(value) || value < 0) return '¥—';
  if (value === 0) return '¥0';
  if (value < 0.000001) return '<¥0.000001';
  if (value >= 1) return '¥' + value.toFixed(2);
  if (value >= 0.01) return '¥' + value.toFixed(4);
  return '¥' + value.toFixed(6);
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

function currentTierLabel(now) {
  if (now < EFFECTIVE_AT_MS) return '当前：旧价格表（新表 2026-08-17 00:00 北京时间生效）';
  return '当前：新价格表 · ' + (isPeakAt(now) ? '高峰时段' : '空闲时段');
}

function rateName(rate) {
  if (rate.mode === 'legacy') return '旧价格表';
  if (rate.mode === 'peak') return '高峰时段';
  return '空闲时段';
}

function rateDetail(rate) {
  return '命中 ¥' + rate.inputHit + '/M · 未命中 ¥' + rate.inputMiss + '/M · 输出 ¥' + rate.output + '/M';
}

function buildTooltip(value, now) {
  var tokens = value.tokens || {};
  var lines = [];
  var hasTokens = (tokens.inputTokens || 0) > 0 || (tokens.outputTokens || 0) > 0;
  if (hasTokens) {
    if ((tokens.inputTokens || 0) > 0) {
      var miss = (tokens.uncachedInputTokens || 0) + (tokens.cacheWriteTokens || 0);
      var line = '输入 ' + formatTokens(tokens.inputTokens)
        + '（未命中 ' + formatTokens(miss)
        + ' · 命中 ' + formatTokens(tokens.cacheReadTokens);
      if ((tokens.cacheWriteTokens || 0) > 0) line += ' · 写入 ' + formatTokens(tokens.cacheWriteTokens);
      line += '）';
      lines.push(line);
    }
    if ((tokens.outputTokens || 0) > 0) lines.push('输出 ' + formatTokens(tokens.outputTokens));
  } else {
    lines.push('当前对话还没有 token 用量');
  }

  if (value.latest) {
    lines.push('模型：' + value.latest.model);
    if (value.latest.rate) {
      lines.push('最近一次计价：' + rateName(value.latest.rate) + '（' + rateDetail(value.latest.rate) + '）');
    }
  }
  lines.push(currentTierLabel(now));
  if (value.complete === false) {
    lines.push('注意：包含未按本价格表计价的模型调用，金额仅为可计价部分');
  }
  return lines.join('\n');
}

function CostBadge(props) {
  var value = props.useProjection('costLog');
  var running = props.useSession(function (snapshot) { return snapshot.running; });
  if (value === undefined) return null;

  var complete = value.complete !== false;
  var amount = Number(value.cost) || 0;
  var amountText = formatCost(amount);
  if (!complete && amount > 0) amountText = '≈' + amountText;
  else if (!complete) amountText = '¥0+';
  var summary = buildTooltip(value, Date.now());

  return React.createElement(
    Tooltip,
    {
      label: function () { return buildTooltip(value, Date.now()); },
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

  // 输入框卡片内、工具行右侧：位于模型选择器左侧，紧贴发送区。
  slots.inject('conversation.input.right', function () {
    return slots.register(
      { name: 'conversation.input.right', id: 'cost-log', order: 40, label: '对话花费' },
      CostBadge,
    );
  });
}

module.exports = { name: 'cost-log', inject: ['slots'], apply: apply };
return module.exports; } });

// dsh-cost-log —— Host 半体（纯手写 ESM，无构建步骤）
//
// 注册会话投影键 `costLog`：把 durable session log 中每一步的
// provider token usage（assistant/chunk usage + assistant/message usage）
// 按模型与请求发生时间折叠成人民币花费。投影是 durable 的，翻页、
// 压缩、历史补拉都不会改变总额；同一步先报 usage chunk、后报
// assistant/message 时只替换，不重复计费。
//
// 价格表：
// - 2026-08-17 00:00（北京时间）之前使用旧价格表。
// - 2026-08-17 00:00（北京时间）起使用峰谷新价格表。
//   高峰：北京时间 9:00-12:00、14:00-18:00；其余为空闲时段。
// - 输入缓存写入（cacheWriteTokens）DeepSeek 不单独报价，按缓存未命中计。
// - 未识别模型不猜测价格：对应用量计入 unpricedTokens，客户端标“≈”。
//
// 旧价格表原文没有模型列名；本插件按并发限制（2500 → flash，500 → pro）
// 与新版同模型上下文，把旧表两列映射为：
//   deepseek-v4-flash: 命中 0.02 / 未命中 1 / 输出 2（元/百万 tokens）
//   deepseek-v4-pro:   命中 0.025 / 未命中 3 / 输出 6（元/百万 tokens）
// 若实际列顺序不同，只需修改下方 LEGACY_RATES。

const KEY = 'costLog'
const MILLION = 1_000_000
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/** 新价格表生效时刻：2026-08-17 00:00 北京时间 = 2026-08-16 16:00 UTC。 */
export const EFFECTIVE_AT_MS = Date.UTC(2026, 7, 16, 16, 0, 0)

const LEGACY_RATES = Object.freeze({
  flash: Object.freeze({ inputHit: 0.02, inputMiss: 1, output: 2 }),
  pro: Object.freeze({ inputHit: 0.025, inputMiss: 3, output: 6 }),
})

const NEW_RATES = Object.freeze({
  flash: Object.freeze({
    offpeak: Object.freeze({ inputHit: 0.05, inputMiss: 1.5, output: 4.5 }),
    peak: Object.freeze({ inputHit: 0.1, inputMiss: 3, output: 9 }),
  }),
  pro: Object.freeze({
    offpeak: Object.freeze({ inputHit: 0.15, inputMiss: 4.5, output: 13.5 }),
    peak: Object.freeze({ inputHit: 0.3, inputMiss: 9, output: 27 }),
  }),
})

const LEGACY_RATES_USD = Object.freeze({
  flash: Object.freeze({ inputHit: 0.0028, inputMiss: 0.14, output: 0.28 }),
  pro: Object.freeze({ inputHit: 0.003625, inputMiss: 0.435, output: 0.87 }),
})

const NEW_RATES_USD = Object.freeze({
  flash: Object.freeze({
    offpeak: Object.freeze({ inputHit: 0.007, inputMiss: 0.22, output: 0.66 }),
    peak: Object.freeze({ inputHit: 0.014, inputMiss: 0.44, output: 1.32 }),
  }),
  pro: Object.freeze({
    offpeak: Object.freeze({ inputHit: 0.022, inputMiss: 0.66, output: 1.98 }),
    peak: Object.freeze({ inputHit: 0.044, inputMiss: 1.32, output: 3.96 }),
  }),
})

/** 模型 id → 价格档。新价格表只覆盖 deepseek-v4-flash / deepseek-v4-pro。 */
export function familyOf(model) {
  const id = String(model ?? '').toLowerCase()
  if (id.includes('v4-pro')) return 'pro'
  if (id.includes('v4-flash')) return 'flash'
  return null
}

/** 北京时间小时+分钟，峰段为 [9:00,12:00) 与 [14:00,18:00)。 */
export function isPeakAt(ms) {
  const shifted = new Date(ms + BEIJING_OFFSET_MS)
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  return (minutes >= 9 * 60 && minutes < 12 * 60)
    || (minutes >= 14 * 60 && minutes < 18 * 60)
}

/**
 * 某一时刻、某一模型的计价点。
 * @returns {null | { mode: 'legacy' | 'offpeak' | 'peak', inputHit: number, inputMiss: number, output: number }}
 */
export function pricePointAt(model, time, currency = 'CNY') {
  const family = familyOf(model)
  if (family === null) return null
  const at = Number.isFinite(time) ? time : Date.now()
  const usd = currency === 'USD'
  if (at < EFFECTIVE_AT_MS) {
    const rates = usd ? LEGACY_RATES_USD[family] : LEGACY_RATES[family]
    return { mode: 'legacy', ...rates }
  }
  const peak = isPeakAt(at)
  const table = usd ? NEW_RATES_USD[family] : NEW_RATES[family]
  const tier = peak ? table.peak : table.offpeak
  return { mode: peak ? 'peak' : 'offpeak', ...tier }
}

/** 某一时刻、某一模型的美元计价点。 */
export function usdPricePointAt(model, time) {
  return pricePointAt(model, time, 'USD')
}

/** 把浮点金额固定到 1e-10，避免二进制浮点尾巴。 */
export function roundCost(value) {
  return Math.round(value * 1e10) / 1e10
}

function finiteNonNegative(value) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function usageBuckets(usage) {
  return {
    inputTokens: finiteNonNegative(usage?.inputTokens),
    outputTokens: finiteNonNegative(usage?.outputTokens),
    cacheReadTokens: finiteNonNegative(usage?.cacheReadTokens),
    cacheWriteTokens: finiteNonNegative(usage?.cacheWriteTokens),
  }
}

function bucketsEqual(left, right) {
  return left.inputTokens === right.inputTokens
    && left.outputTokens === right.outputTokens
    && left.cacheReadTokens === right.cacheReadTokens
    && left.cacheWriteTokens === right.cacheWriteTokens
}

/** 缓存未命中 = 未缓存输入 + 缓存写入（DeepSeek 不单独报 write）。 */
function missTokens(buckets) {
  return buckets.inputTokens + buckets.cacheWriteTokens
}

function bucketTotal(buckets) {
  return buckets.inputTokens + buckets.outputTokens
    + buckets.cacheReadTokens + buckets.cacheWriteTokens
}

function costFor(buckets, rate) {
  return (missTokens(buckets) * rate.inputMiss
    + buckets.cacheReadTokens * rate.inputHit
    + buckets.outputTokens * rate.output) / MILLION
}

function zeroTotal() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
    costUsd: 0,
    unpricedTokens: 0,
  }
}

function init() {
  return {
    total: zeroTotal(),
    byModel: {},
    last: null,
    headerModel: null,
  }
}

/** 把一步 usage 按 sign 加减进 byModel 聚合；返回新的 byModel。 */
function shiftModel(byModel, model, buckets, sign, rate, rateUsd) {
  const key = String(model ?? '') || 'unknown'
  const old = byModel[key]
  const next = old === undefined
    ? {
      inputTokens: buckets.inputTokens * sign,
      outputTokens: buckets.outputTokens * sign,
      cacheReadTokens: buckets.cacheReadTokens * sign,
      cacheWriteTokens: buckets.cacheWriteTokens * sign,
      cost: 0,
      costUsd: 0,
      priced: rate !== null,
    }
    : {
      inputTokens: old.inputTokens + buckets.inputTokens * sign,
      outputTokens: old.outputTokens + buckets.outputTokens * sign,
      cacheReadTokens: old.cacheReadTokens + buckets.cacheReadTokens * sign,
      cacheWriteTokens: old.cacheWriteTokens + buckets.cacheWriteTokens * sign,
      cost: old.cost,
      costUsd: old.costUsd,
      priced: old.priced,
    }

  if (rate === null) {
    next.priced = false
  } else {
    next.cost = roundCost((old?.cost ?? 0) + costFor(buckets, rate) * sign)
    next.costUsd = roundCost((old?.costUsd ?? 0) + costFor(buckets, rateUsd) * sign)
    next.priced = true
  }

  // 删除减到零的模型行，保持 state 与 view 干净。
  const empty = next.inputTokens === 0
    && next.outputTokens === 0
    && next.cacheReadTokens === 0
    && next.cacheWriteTokens === 0
    && next.cost === 0
    && next.costUsd === 0
  if (empty) {
    if (old === undefined) return byModel
    const copy = { ...byModel }
    delete copy[key]
    return copy
  }
  return { ...byModel, [key]: next }
}

function foldUsage(state, sample) {
  const buckets = usageBuckets(sample.usage)
  const prev = state.last !== null
    && state.last.turn === sample.turn
    && state.last.step === sample.step
    ? state.last
    : null

  // usage chunk 与 assistant/message 重复报同一步且完全相同：不重复计。
  if (prev !== null
    && prev.model === sample.model
    && bucketsEqual(prev.buckets, buckets)) {
    return state
  }

  let total = state.total
  let byModel = state.byModel

  if (prev !== null) {
    const prevRate = pricePointAt(prev.model, prev.time)
    const prevRateUsd = usdPricePointAt(prev.model, prev.time)
    const prevCost = prevRate === null ? 0 : costFor(prev.buckets, prevRate)
    const prevCostUsd = prevRateUsd === null ? 0 : costFor(prev.buckets, prevRateUsd)
    const prevUnpriced = prevRate === null ? bucketTotal(prev.buckets) : 0
    total = {
      ...total,
      inputTokens: total.inputTokens - prev.buckets.inputTokens,
      outputTokens: total.outputTokens - prev.buckets.outputTokens,
      cacheReadTokens: total.cacheReadTokens - prev.buckets.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens - prev.buckets.cacheWriteTokens,
      cost: roundCost(total.cost - prevCost),
      costUsd: roundCost(total.costUsd - prevCostUsd),
      unpricedTokens: total.unpricedTokens - prevUnpriced,
    }
    byModel = shiftModel(byModel, prev.model, prev.buckets, -1, prevRate, prevRateUsd)
  }

  const rate = pricePointAt(sample.model, sample.time)
  const rateUsd = usdPricePointAt(sample.model, sample.time)
  const sampleCost = rate === null ? 0 : costFor(buckets, rate)
  const sampleCostUsd = rateUsd === null ? 0 : costFor(buckets, rateUsd)
  const sampleUnpriced = rate === null ? bucketTotal(buckets) : 0
  total = {
    ...total,
    inputTokens: total.inputTokens + buckets.inputTokens,
    outputTokens: total.outputTokens + buckets.outputTokens,
    cacheReadTokens: total.cacheReadTokens + buckets.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens + buckets.cacheWriteTokens,
    cost: roundCost(total.cost + sampleCost),
    costUsd: roundCost(total.costUsd + sampleCostUsd),
    unpricedTokens: total.unpricedTokens + sampleUnpriced,
  }
  byModel = shiftModel(byModel, sample.model, buckets, 1, rate, rateUsd)

  return {
    total,
    byModel,
    last: {
      turn: sample.turn,
      step: sample.step,
      model: String(sample.model ?? '') || 'unknown',
      time: sample.time,
      buckets,
    },
    headerModel: state.headerModel,
  }
}

function apply(state, event) {
  if (event.type === 'request/header') {
    const model = event.data?.header?.config?.model
    if (typeof model === 'string' && model !== state.headerModel) {
      return { ...state, headerModel: model }
    }
    return state
  }

  if (event.type === 'assistant/chunk') {
    const chunk = event.data?.chunk
    if (chunk?.type !== 'usage') return state
    return foldUsage(state, {
      turn: event.data.turn,
      step: event.data.step,
      model: state.headerModel,
      time: event.time,
      usage: chunk.usage,
    })
  }

  if (event.type === 'assistant/message') {
    const usage = event.data?.usage
    if (usage === undefined) return state
    const model = event.data?.message?.source?.model ?? state.headerModel
    return foldUsage(state, {
      turn: event.data.turn,
      step: event.data.step,
      model,
      time: event.time,
      usage,
    })
  }

  return state
}

function view(state) {
  const total = state.total
  const billedInput = total.inputTokens + total.cacheReadTokens + total.cacheWriteTokens
  const byModel = Object.keys(state.byModel).map((model) => {
    const entry = state.byModel[model]
    return {
      model,
      cost: entry.cost,
      costUsd: entry.costUsd,
      priced: entry.priced === true,
      tokens: {
        inputTokens: entry.inputTokens + entry.cacheReadTokens + entry.cacheWriteTokens,
        uncachedInputTokens: entry.inputTokens,
        cacheReadTokens: entry.cacheReadTokens,
        cacheWriteTokens: entry.cacheWriteTokens,
        outputTokens: entry.outputTokens,
      },
    }
  }).sort((a, b) => b.cost - a.cost || b.tokens.inputTokens - a.tokens.inputTokens)

  const last = state.last
  return {
    currency: 'CNY',
    /** 可计价部分的人民币总额（元）。 */
    cost: roundCost(total.cost),
    /** 可计价部分的美元总额。 */
    costUsd: roundCost(total.costUsd),
    /** false 表示对话里存在无法按本价格表计价的模型调用。 */
    complete: total.unpricedTokens === 0,
    tokens: {
      /** 计费输入 tokens = 未命中 + 命中 + 写入。 */
      inputTokens: billedInput,
      uncachedInputTokens: total.inputTokens,
      cacheReadTokens: total.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens,
      outputTokens: total.outputTokens,
    },
    byModel,
    latest: last === null ? null : {
      model: last.model,
      time: last.time,
      rate: pricePointAt(last.model, last.time),
      rateUsd: usdPricePointAt(last.model, last.time),
    },
  }
}

/** 费用货币设置：在 DSH 设置 > 通用里选择。 */
export const COST_LOG_SETTINGS_NAMESPACE = 'cost-log'
export const CURRENCY_FIELD = 'currency'
export const CURRENCIES = ['CNY', 'USD']
export const DEFAULT_CURRENCY = 'CNY'

/**
 * 手写 schemastery 兼容 schema：不需要在单元测试环境引入外部依赖。
 * toJSON 输出与 `z.object({ currency: z.union(['CNY','USD']).default('CNY') })`
 * 的序列化结果一致，DSH 设置面板可以正常 rehydrate。
 */
export function costLogSettingsSchema(value) {
  const source = (value !== null && typeof value === 'object' && !Array.isArray(value)) ? value : {}
  return { [CURRENCY_FIELD]: source[CURRENCY_FIELD] === 'USD' ? 'USD' : DEFAULT_CURRENCY }
}

costLogSettingsSchema.toJSON = function () {
  return {
    uid: 6,
    refs: {
      2: { type: 'const', meta: { required: true }, value: 'CNY' },
      4: { type: 'const', meta: { required: true }, value: 'USD' },
      5: { type: 'union', meta: { default: 'CNY' }, list: [2, 4] },
      6: { type: 'object', meta: { default: {} }, dict: { currency: 5 } },
    },
  }
}

/** 手写 schema：registry 只调用 parse()，无 zod 依赖。 */
const schema = {
  parse(value) {
    if (value === null || typeof value !== 'object') throw new TypeError('costLog: view must be an object')
    if (value.currency !== 'CNY') throw new TypeError('costLog: currency must be CNY')
    if (!Number.isFinite(value.cost) || value.cost < 0) throw new TypeError('costLog: invalid cost')
    if (typeof value.complete !== 'boolean') throw new TypeError('costLog: invalid complete')
    if (!Array.isArray(value.byModel)) throw new TypeError('costLog: byModel must be an array')
    return value
  },
}

export const costLogProjection = Object.freeze({
  key: KEY,
  schema,
  init,
  apply,
  view,
  stateVersion: 1,
})

export default {
  name: 'cost-log',
  inject: ['sessionProjections'],
  apply(ctx) {
    const registry = ctx.get('sessionProjections')
    if (registry === undefined) {
      ctx.logger?.warn?.('[cost-log] host bailed: sessionProjections service unavailable')
      return
    }
    ctx.effect(() => registry.register(costLogProjection), 'cost-log: session projection')

    // 注册费用货币设置（可选依赖；settings 服务存在时生效）。
    if (typeof ctx.inject === 'function') {
      ctx.inject(['settings'], (settingsCtx) => {
        settingsCtx.settings.register(
          COST_LOG_SETTINGS_NAMESPACE,
          costLogSettingsSchema,
          { applies: 'live' },
        )
      })
    }
  },
}

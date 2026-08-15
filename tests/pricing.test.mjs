import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EFFECTIVE_AT_MS,
  costLogProjection,
  familyOf,
  isOfficialDeepSeekModel,
  isPeakAt,
  pricePointAt,
  usdPricePointAt,
} from '../lib/index.js'

const HOUR = 3_600_000

function event(type, seq, time, data) {
  return { type, seq, time, data }
}

function usage(inputTokens, outputTokens, cacheReadTokens = 0, cacheWriteTokens = 0) {
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
}

test('新价格表生效时刻是北京时间 2026-08-17 00:00', () => {
  assert.equal(EFFECTIVE_AT_MS, Date.UTC(2026, 7, 16, 16))
  assert.equal(new Date(EFFECTIVE_AT_MS + 8 * HOUR).toISOString(), '2026-08-17T00:00:00.000Z')
})

test('峰谷判断按北京时间', () => {
  const bj = (day, hour, minute = 0) => Date.UTC(2026, 7, day, hour - 8, minute)
  assert.equal(isPeakAt(bj(17, 8, 59)), false)
  assert.equal(isPeakAt(bj(17, 9, 0)), true)
  assert.equal(isPeakAt(bj(17, 11, 59)), true)
  assert.equal(isPeakAt(bj(17, 12, 0)), false)
  assert.equal(isPeakAt(bj(17, 13, 59)), false)
  assert.equal(isPeakAt(bj(17, 14, 0)), true)
  assert.equal(isPeakAt(bj(17, 17, 59)), true)
  assert.equal(isPeakAt(bj(17, 18, 0)), false)
  assert.equal(isPeakAt(bj(18, 10, 0)), true)
})

test('生效前使用旧价格表，生效后使用峰谷价格表', () => {
  assert.deepEqual(pricePointAt('deepseek-v4-flash', EFFECTIVE_AT_MS - 1), {
    mode: 'legacy', inputHit: 0.02, inputMiss: 1, output: 2,
  })
  assert.deepEqual(pricePointAt('deepseek-v4-pro', EFFECTIVE_AT_MS - 1), {
    mode: 'legacy', inputHit: 0.025, inputMiss: 3, output: 6,
  })
  assert.deepEqual(pricePointAt('deepseek-v4-flash', Date.UTC(2026, 7, 17, 2)), {
    mode: 'peak', inputHit: 0.1, inputMiss: 3, output: 9,
  })
  assert.deepEqual(pricePointAt('deepseek-v4-flash', Date.UTC(2026, 7, 17, 4)), {
    mode: 'offpeak', inputHit: 0.05, inputMiss: 1.5, output: 4.5,
  })
  assert.deepEqual(pricePointAt('deepseek-v4-pro', Date.UTC(2026, 7, 17, 2)), {
    mode: 'peak', inputHit: 0.3, inputMiss: 9, output: 27,
  })
  assert.equal(pricePointAt('some-other-model', Date.UTC(2026, 7, 17, 2)), null)
})

test('只核验 DeepSeek 官方 provider 与完整 V4 模型名称', () => {
  assert.equal(familyOf('DeepSeek-V4-Flash'), 'flash')
  assert.equal(familyOf('DeepSeek-V4-Pro'), 'pro')
  assert.equal(familyOf('third-party/v4-flash'), null)
  assert.equal(familyOf('deepseek-v4-pro-preview'), null)
  assert.equal(isOfficialDeepSeekModel('deepseek-official', 'DeepSeek-V4-Flash'), true)
  assert.equal(isOfficialDeepSeekModel('third-party', 'deepseek-v4-flash'), false)
})

test('会话投影把 usage 折叠为人民币成本', () => {
  let state = costLogProjection.init()
  const at = Date.UTC(2026, 7, 17, 4) // 北京 12:00，空闲
  state = costLogProjection.apply(state, event('request/header', 0, at - 10, {
    header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, reason: 'initial' },
  }))
  state = costLogProjection.apply(state, event('assistant/message', 1, at, {
    turn: 1,
    step: 1,
    message: { source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
    usage: usage(1_000_000, 1_000_000, 0, 0),
  }))
  const value = costLogProjection.view(state)
  assert.equal(value.cost, 6) // 1.5 输入 + 4.5 输出
  assert.equal(value.complete, true)
  assert.equal(value.tokens.inputTokens, 1_000_000)
  assert.equal(value.tokens.outputTokens, 1_000_000)
  assert.equal(value.byModel.length, 1)
  assert.equal(value.latest.rate.mode, 'offpeak')
})

test('同一步 usage chunk 与 assistant/message 只计一次', () => {
  let state = costLogProjection.init()
  const at = Date.UTC(2026, 7, 17, 4, 0, 10) // 北京 12:00:10，空闲
  state = costLogProjection.apply(state, event('request/header', 0, at - 20, {
    header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-pro' }, reason: 'initial' },
  }))
  state = costLogProjection.apply(state, event('assistant/chunk', 1, at - 10, {
    turn: 1,
    step: 1,
    chunk: { type: 'usage', usage: usage(500_000, 100_000, 200_000, 0) },
  }))
  const early = costLogProjection.view(state)
  // 未命中 500K*4.5 + 命中 200K*0.15 + 输出 100K*13.5 = 2.25 + 0.03 + 1.35
  assert.equal(early.cost, 3.63)
  state = costLogProjection.apply(state, event('assistant/message', 2, at, {
    turn: 1,
    step: 1,
    message: { source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-pro' } },
    usage: usage(500_000, 100_000, 200_000, 0),
  }))
  assert.equal(costLogProjection.view(state).cost, 3.63)
})

test('同一路径后续 usage 替换早期样本', () => {
  let state = costLogProjection.init()
  const at = Date.UTC(2026, 7, 17, 4)
  state = costLogProjection.apply(state, event('request/header', 0, at - 20, {
    header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, reason: 'initial' },
  }))
  state = costLogProjection.apply(state, event('assistant/chunk', 1, at - 10, {
    turn: 1,
    step: 1,
    chunk: { type: 'usage', usage: usage(100, 0, 0, 0) },
  }))
  state = costLogProjection.apply(state, event('assistant/message', 2, at, {
    turn: 1,
    step: 1,
    message: { source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
    usage: usage(1_000_000, 1_000_000, 0, 0),
  }))
  assert.equal(costLogProjection.view(state).cost, 6)
})

test('未识别模型不猜价格并标记 complete=false', () => {
  let state = costLogProjection.init()
  const at = Date.UTC(2026, 7, 17, 4)
  state = costLogProjection.apply(state, event('assistant/message', 1, at, {
    turn: 1,
    step: 1,
    message: { source: { kind: 'model', provider: 'pi-ai', model: 'claude-opus' } },
    usage: usage(1000, 2000, 0, 0),
  }))
  const value = costLogProjection.view(state)
  assert.equal(value.cost, 0)
  assert.equal(value.complete, false)
  assert.equal(value.byModel[0].priced, false)
  assert.equal(value.byModel[0].tokens.inputTokens, 1000)
})

test('第三方 provider 使用同名模型也不套用官方价格', () => {
  let state = costLogProjection.init()
  const at = Date.UTC(2026, 7, 17, 4)
  state = costLogProjection.apply(state, event('assistant/message', 1, at, {
    turn: 1,
    step: 1,
    message: { source: { kind: 'model', provider: 'third-party', model: 'deepseek-v4-pro' } },
    usage: usage(1_000_000, 1_000_000),
  }))
  const value = costLogProjection.view(state)
  assert.equal(value.cost, 0)
  assert.equal(value.complete, false)
  assert.equal(value.byModel[0].provider, 'third-party')
  assert.equal(value.byModel[0].priced, false)
})

test('交错步骤的最终 usage 分别替换各自的早期样本', () => {
  let state = costLogProjection.init()
  const at = Date.UTC(2026, 7, 17, 4)
  state = costLogProjection.apply(state, event('request/header', 0, at - 100, {
    header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, reason: 'initial' },
  }))
  state = costLogProjection.apply(state, event('assistant/chunk', 1, at, {
    turn: 1, step: 1, chunk: { type: 'usage', usage: usage(1_000_000, 1_000_000) },
  }))
  state = costLogProjection.apply(state, event('assistant/message', 2, at + 1, {
    turn: 1,
    step: 2,
    message: { source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
    usage: usage(1_000_000, 1_000_000),
  }))
  state = costLogProjection.apply(state, event('assistant/message', 3, at + 2, {
    turn: 1,
    step: 1,
    message: { source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
    usage: usage(2_000_000, 2_000_000),
  }))
  const value = costLogProjection.view(state)
  assert.equal(value.cost, 18)
  assert.equal(value.tokens.inputTokens, 3_000_000)
  assert.equal(value.tokens.outputTokens, 3_000_000)
})

test('跨峰谷边界的请求使用 step/start 时的价格', () => {
  let state = costLogProjection.init()
  const started = Date.UTC(2026, 7, 17, 3, 59) // 北京 11:59，高峰
  const completed = Date.UTC(2026, 7, 17, 4, 1) // 北京 12:01，空闲
  state = costLogProjection.apply(state, event('request/header', 0, started - 10, {
    header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, reason: 'initial' },
  }))
  state = costLogProjection.apply(state, event('step/start', 1, started, { turn: 1, step: 1 }))
  state = costLogProjection.apply(state, event('assistant/message', 2, completed, {
    turn: 1,
    step: 1,
    message: { source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
    usage: usage(1_000_000, 1_000_000),
  }))
  const value = costLogProjection.view(state)
  assert.equal(value.cost, 12)
  assert.equal(value.latest.time, started)
  assert.equal(value.latest.rate.mode, 'peak')
})

test('美元价格表使用 DeepSeek 官方 USD 报价', () => {
  assert.deepEqual(usdPricePointAt('deepseek-v4-flash', EFFECTIVE_AT_MS - 1), {
    mode: 'legacy', inputHit: 0.0028, inputMiss: 0.14, output: 0.28,
  })
  assert.deepEqual(usdPricePointAt('deepseek-v4-pro', EFFECTIVE_AT_MS - 1), {
    mode: 'legacy', inputHit: 0.003625, inputMiss: 0.435, output: 0.87,
  })
  assert.deepEqual(usdPricePointAt('deepseek-v4-flash', Date.UTC(2026, 7, 17, 2)), {
    mode: 'peak', inputHit: 0.014, inputMiss: 0.44, output: 1.32,
  })
  assert.deepEqual(usdPricePointAt('deepseek-v4-flash', Date.UTC(2026, 7, 17, 4)), {
    mode: 'offpeak', inputHit: 0.007, inputMiss: 0.22, output: 0.66,
  })
  assert.deepEqual(usdPricePointAt('deepseek-v4-pro', Date.UTC(2026, 7, 17, 2)), {
    mode: 'peak', inputHit: 0.044, inputMiss: 1.32, output: 3.96,
  })
  assert.equal(usdPricePointAt('some-other-model', Date.UTC(2026, 7, 17, 2)), null)
  assert.deepEqual(pricePointAt('deepseek-v4-flash', Date.UTC(2026, 7, 17, 2), 'USD'), {
    mode: 'peak', inputHit: 0.014, inputMiss: 0.44, output: 1.32,
  })
})

test('会话投影同时输出人民币与美元成本', () => {
  let state = costLogProjection.init()
  const at = Date.UTC(2026, 7, 17, 4) // 北京 12:00，空闲
  state = costLogProjection.apply(state, event('request/header', 0, at - 10, {
    header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, reason: 'initial' },
  }))
  state = costLogProjection.apply(state, event('assistant/message', 1, at, {
    turn: 1,
    step: 1,
    message: { source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
    usage: usage(1_000_000, 1_000_000, 0, 0),
  }))
  const value = costLogProjection.view(state)
  assert.equal(value.cost, 6) // 1.5 + 4.5 元
  assert.equal(value.costUsd, 0.88) // 0.22 + 0.66 美元
  assert.equal(value.currency, 'CNY')
  assert.equal(value.latest.rate.mode, 'offpeak')
  assert.equal(value.latest.rateUsd.mode, 'offpeak')
  assert.equal(value.byModel[0].costUsd, 0.88)
})

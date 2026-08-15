# dsh-cost-log

**English** · [**中文**](#zh)

DSH native plugin: real-time current conversation cost based on DeepSeek pricing, displayed as a badge beside the input box (right side of the composer tool row, to the left of the model selector). Cost is computed by a durable Host session projection `costLog`, so paging, compaction, or history backfill never change the accumulated value. The browser only reads and renders the projection — no external requests.

## Features

- Always-visible cost badge next to the input box; updates as token usage changes. Currency is configurable in DSH Settings > Plugins > **Plugin configuration** (CNY / USD, default CNY).
- Tooltip language follows the DSH system language (Chinese / English).
- Clicking the cost icon shows only: input tokens, output tokens, flash cost, pro cost.
- CNY pricing since 2026-08-17:
  - `deepseek-v4-flash`: off-peak 0.05 / 1.5 / 4.5, peak 0.10 / 3.0 / 9.0 (CNY per million tokens)
  - `deepseek-v4-pro`: off-peak 0.15 / 4.5 / 13.5, peak 0.30 / 9.0 / 27.0 (CNY per million tokens)
- Official DeepSeek USD pricing:
  - `deepseek-v4-flash`: off-peak $0.007 / $0.22 / $0.66, peak $0.014 / $0.44 / $1.32 (USD per million tokens)
  - `deepseek-v4-pro`: off-peak $0.022 / $0.66 / $1.98, peak $0.044 / $1.32 / $3.96 (USD per million tokens)
- Peak hours use Beijing time: `9:00-12:00`, `14:00-18:00`; all other hours are off-peak, at half the peak rate.
- Before the effective time, legacy pricing (both CNY and USD) is used automatically.
- Unrecognized third-party models are never guessed: the badge shows `≈` / `¥0+` (or `≈` / `$0+`).
- Styles use DSH WebUI design tokens (`--dsw-alias-*`) and follow light / dark themes.

## Pricing basis

| Usage | Billing |
| --- | --- |
| Input (cache miss) | `inputTokens`, billed as 1M input tokens (cache miss) |
| Input (cache hit) | `cacheReadTokens`, billed as 1M input tokens (cache hit) |
| Cache write | `cacheWriteTokens`; DeepSeek does not quote this separately, billed as cache miss |
| Output | `outputTokens`, billed as 1M output tokens |

> The amount is a reference estimate based on provider-reported token usage, not an official DeepSeek bill. Usage chunks and `assistant/message` for the same `turn/step` are de-duplicated by the projection replacement rules.

### Legacy price mapping

The legacy pricing table has no model column. This plugin maps the two columns by concurrency limit (2500 -> flash, 500 -> pro), consistent with the new table:

```js
// lib/index.js
const LEGACY_RATES = {
  flash: { inputHit: 0.02, inputMiss: 1, output: 2 },
  pro:   { inputHit: 0.025, inputMiss: 3, output: 6 },
}

const LEGACY_RATES_USD = {
  flash: { inputHit: 0.0028, inputMiss: 0.14, output: 0.28 },
  pro:   { inputHit: 0.003625, inputMiss: 0.435, output: 0.87 },
}
```

If your legacy column order differs, edit `LEGACY_RATES` / `LEGACY_RATES_USD` at the top of `lib/index.js`; no client changes are required.

## Architecture

```
Browser (Client)                               DSH Host
┌────────────────────────────┐   session   ┌──────────────────────────────┐
│ conversation.input.right    │  projection │ sessionProjections registry  │
│ cost badge beside input     │ ◄────────── │ costLog projection            │
│ useProjection('costLog')    │  durable    │  ├ request/header model       │
│ React + hand-written bundle │             │  ├ assistant/chunk usage     │
│ locale + settingsScope      │             │  └ assistant/message usage   │
└────────────────────────────┘             │ cost by time x model x tier │
                                            │ outputs both CNY / USD       │
                                            └──────────────────────────────┘
```

- **Host** ([`lib/index.js`](lib/index.js)): registers the `sessionProjections` key `costLog` and outputs both CNY and USD cost; also registers the `cost-log` settings namespace for currency selection.
- **Client** ([`lib/client.js`](lib/client.js)): hand-written CJS bundle (`window.__ModuleLoader__.load`), registered in the `conversation.input.right` slot, reads `useProjection('costLog')`, localizes tooltips via the `locale` service, and reads the selected currency via `settingsScope`.
- No external HTTP calls, no cookies, no database, no local server, no build step.

## Installation

From npm:

```bash
dsh plugin --profile web add dsh-cost-log
```

From GitHub:

```bash
dsh plugin --profile web add github:kami-mura/dsh-cost
```

Then restart the DSH web service:

```bash
dshctl restart
```

Uninstall:

```bash
dsh plugin --profile web remove dsh-cost-log
```

> Requires DSH runtime capabilities: Host `sessionProjections` and optional `settings` services; Client `slots`, `locale`, optional `settingsScope`, the `react` platform module, and the `conversation.input.right` slot provided by `ui-conversation`.

## Files

| File | Description |
| --- | --- |
| `lib/index.js` | Host half (`costLog` session projection + peak/off-peak pricing + settings namespace) |
| `lib/client.js` | Client bundle (cost badge + Plugin configuration currency card) |
| `cordis.patch.yml` | Bundle patch (mounts the Host half in the profile layer stack) |
| `package.json` | Package manifest (`dsh.bundle.patch` + `dsh.client.platform: "web"`) |
| `tests/pricing.test.mjs` | Unit tests for peak/off-peak pricing and projection folding |

Run tests:

```bash
node --test tests/*.test.mjs
```

## License

[MIT](LICENSE)

---

<a id="zh"></a>

# dsh-cost-log（中文）

DSH 原生插件：按 DeepSeek 价格表实时计算**当前对话花费**，并把金额徽标放在**输入框旁边**（输入框卡片工具行右侧、模型选择器左侧）。金额由 Host 端的 durable 会话投影 `costLog` 计算，跟着会话日志走——翻页、上下文压缩、历史补拉都不会改变累计值；浏览器端只读投影并渲染，不发任何外部请求。

## 功能

- 输入框旁常驻金额徽标，token 用量变化时自动更新；货币可在 DSH 设置 > 插件 > **Plugin configuration** 中选择（CNY / USD，默认 CNY）。
- 悬浮提示语言跟随 DSH 系统语言（中文 / English）。
- 点击费用图标后只显示：输入 tokens、输出 tokens、flash 花费、pro 花费。
- 2026-08-17 起人民币新价格表：
  - `deepseek-v4-flash`：空闲 0.05 / 1.5 / 4.5，高峰 0.10 / 3.0 / 9.0（元/百万 tokens）
  - `deepseek-v4-pro`：空闲 0.15 / 4.5 / 13.5，高峰 0.30 / 9.0 / 27.0（元/百万 tokens）
- DeepSeek 官方美元价格表：
  - `deepseek-v4-flash`：空闲 $0.007 / $0.22 / $0.66，高峰 $0.014 / $0.44 / $1.32（美元/百万 tokens）
  - `deepseek-v4-pro`：空闲 $0.022 / $0.66 / $1.98，高峰 $0.044 / $1.32 / $3.96（美元/百万 tokens）
- 高峰时段按北京时间：`9:00-12:00`、`14:00-18:00`；其余为空闲，空闲价为高峰价一半。
- 生效时刻之前自动使用旧价格表（人民币与美元均为旧表）。
- 未识别的第三方模型不猜价：徽标显示 `≈`/`¥0+` 或 `≈`/`$0+`。
- 样式使用 DSH WebUI 设计令牌（`--dsw-alias-*`），明暗主题自动跟随。

## 计价口径

| 用量 | 计费方式 |
| --- | --- |
| 缓存未命中输入 | `inputTokens`，按“百万 tokens 输入（缓存未命中）” |
| 缓存命中输入 | `cacheReadTokens`，按“百万 tokens 输入（缓存命中）” |
| 缓存写入 | `cacheWriteTokens`，DeepSeek 不单独报价，按缓存未命中计 |
| 输出 | `outputTokens`，按“百万 tokens 输出” |

> 金额是依据 provider 上报 token usage 的**参考估算**，不是 DeepSeek 官方账单。usage chunk 与同一 `turn/step` 的 `assistant/message` 会按 projection 替换规则去重，不会重复计费。

### 旧价格表映射

旧价格表原文没有模型列名。本插件按并发限制（2500 → flash，500 → pro）以及新版同模型上下文，把两列映射为：

```js
// lib/index.js
const LEGACY_RATES = {
  flash: { inputHit: 0.02, inputMiss: 1, output: 2 },
  pro:   { inputHit: 0.025, inputMiss: 3, output: 6 },
}

const LEGACY_RATES_USD = {
  flash: { inputHit: 0.0028, inputMiss: 0.14, output: 0.28 },
  pro:   { inputHit: 0.003625, inputMiss: 0.435, output: 0.87 },
}
```

如果你的实际旧表列顺序不同，改 `lib/index.js` 顶部的 `LEGACY_RATES` / `LEGACY_RATES_USD` 即可；客户端无需改动。

## 架构

```
浏览器 (Client)                               DSH Host
┌────────────────────────────┐   session   ┌──────────────────────────────┐
│ conversation.input.right    │  projection │ sessionProjections 注册表    │
│ 输入框工具行右侧费用徽标    │ ◄────────── │ costLog 投影                 │
│ useProjection('costLog')    │  durable    │  ├ request/header 记当前模型  │
│ React + 手写 bundle          │             │  ├ assistant/chunk usage     │
│ locale + settingsScope       │             │  └ assistant/message usage  │
└────────────────────────────┘             │ 按时间 × 模型 × 峰谷计价      │
                                            │ 同时输出 CNY / USD            │
                                            └──────────────────────────────┘
```

- **Host**（[`lib/index.js`](lib/index.js)）：注册 `sessionProjections` 投影键 `costLog`，同时输出人民币与美元成本；并注册 `cost-log` 设置命名空间（货币选择）。
- **Client**（[`lib/client.js`](lib/client.js)）：手写 CJS bundle（`window.__ModuleLoader__.load`），注册在 `conversation.input.right` 插槽（由 `ui-conversation` 提供，就在输入框卡片内），读取 `useProjection('costLog')`；通过 `locale` 服务显示系统语言，通过 `settingsScope` 读取用户选择的货币，并在 Plugin configuration 提供费用货币卡片。
- 无外部 HTTP 调用、无 Cookie、无数据库、无本地服务、无构建步骤。

## 安装

从 npm 安装：

```bash
dsh plugin --profile web add dsh-cost-log
```

从 GitHub 安装：

```bash
dsh plugin --profile web add github:kami-mura/dsh-cost
```

安装后需**重启 dsh web 服务**：

```bash
dshctl restart
```

卸载：

```bash
dsh plugin --profile web remove dsh-cost-log
```

> 依赖 DSH 运行时能力：Host `sessionProjections` 与可选 `settings` 服务；Client `slots`、`locale`、可选 `settingsScope`、`react` 平台模块与 `ui-conversation` 的 `conversation.input.right` 插槽（DSH 内置）。

## 文件

| 文件 | 说明 |
| --- | --- |
| `lib/index.js` | Host 半体（`costLog` 会话投影 + 峰谷计价 + 设置命名空间） |
| `lib/client.js` | Client bundle（输入框旁花费徽标 + Plugin configuration 货币卡片） |
| `cordis.patch.yml` | 组合包 patch（安装后加入 profile 层栈） |
| `package.json` | 包声明（`dsh.bundle.patch` + `dsh.client.platform: "web"`） |
| `tests/pricing.test.mjs` | 峰谷判断与投影折叠的单元测试 |

运行测试：

```bash
node --test tests/*.test.mjs
```

## License

[MIT](LICENSE)

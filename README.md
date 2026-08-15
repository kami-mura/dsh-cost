# dsh-cost-log

English | [简体中文](./README.zh-CN.md)

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

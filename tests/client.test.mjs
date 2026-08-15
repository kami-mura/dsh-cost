import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

test('客户端 bundle 使用 npm 包名向 DSH ModuleLoader 注册', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  let handoff
  const injectedSlots = []
  const window = {
    localStorage: {
      getItem() { return null },
      setItem() {},
    },
    __ModuleLoader__: {
      load(value) { handoff = value },
    },
  }
  const document = {
    createElement() { return { dataset: {}, parentNode: null, textContent: '' } },
    head: { appendChild() {} },
  }

  vm.runInNewContext(code, { window, document, Set })

  assert.equal(handoff?.id, manifest.name)
  assert.equal(typeof handoff?.factory, 'function')

  const plugin = handoff.factory((id) => {
    if (id === 'react') return { createElement() {} }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Tooltip() {} }
    throw new Error(`unexpected client dependency: ${id}`)
  })
  plugin.apply({
    get(name) {
      if (name === 'slots') return { inject(slot) { injectedSlots.push(slot) } }
      return undefined
    },
    effect(callback) { callback() },
  })

  assert.deepEqual(injectedSlots, ['conversation.input.right', 'settings.plugin.item'])
})

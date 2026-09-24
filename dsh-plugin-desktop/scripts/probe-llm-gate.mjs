/**
 * Headless probe — `llm/stream` waterfall 的短路语义。
 *
 * 回答的问题（auth-gate 评估 §6 探针 2）：
 *   1. 不调 `next()` 直接返回自己的 AsyncIterable，短路是否成立、adapter 是否被跳过？
 *   2. 短路必须 yield 的最小合法 chunk 序列是什么？下游组装器能否消费？
 *   3. **反证**：注销 handler 后 adapter 是否恢复被调用（证明链路本身是通的）？
 *   4. `llm/stream` handler 的 `this` 绑定与 `next` 形态。
 *
 * 设计：起一个**最小 Host**（只插 `llm` 行），不加载 desktop profile ——
 * 被验证的是纯 cordis 语义，与桌面无关；而 desktop profile 会拉进
 * `dsh-plugin-desktop` 一批需要 Electron 服务的行（webServer 双重注册、
 * desktopRuntime.registerTrayItem 缺失）。
 *
 * 不需要 API key、不需要网络：短路路径根本不触达 adapter。
 *
 * 用法：node scripts/probe-llm-gate.mjs
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'

const BIN_NAME = 'dsh-auth-gate-probe'
const MODULE_BASE = pathToFileURL(fileURLToPath(new URL('../package.json', import.meta.url))).href
const BLOCKED_TEXT = '[blocked: 未授权]'
const REQUEST = { provider: 'probe-gate', model: 'probe-model', messages: [] }

/** 收集一条 chunk 流并捕获错误。 */
const drain = async (iterable) => {
  const chunks = []
  try {
    for await (const chunk of iterable) chunks.push(chunk)
    return { chunks, error: null }
  } catch (error) {
    return { chunks, error: `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}` }
  }
}

/** 用 BlockAssembler 组装一条流，验证下游消费者能否吃下短路的 chunk。 */
const assemble = (chunks) => {
  try {
    const assembler = new BlockAssembler()
    for (const chunk of chunks) assembler.push(chunk)
    return {
      blocks: assembler.blocks(),
      finish: assembler.finish,
      error: null,
    }
  } catch (error) {
    return { blocks: null, finish: null, error: `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}` }
  }
}

const home = mkdtempSync(join(tmpdir(), 'dsh-auth-gate-probe-'))
const rootConfig = join(home, 'root.yml')
writeFileSync(rootConfig, '[]\n')

const report = {
  handlerCalls: 0,
  handlerThis: null,
  handlerNextType: null,
  handlerOptionsKeys: null,
  adapterStreamCalls: 0,
  providers: null,
}
let detachHandler
let host
let probes = {}

try {
  host = await boot(
    BIN_NAME,
    rootConfig,
    [{ insert: [{ id: 'llm', name: '@deepseek-ai/dsh-llm' }] }],
    (ctx) => {
      report.registeredDuringProvide = true
      detachHandler = ctx.on(
        'llm/stream',
        function (options, next) {
          report.handlerCalls += 1
          report.handlerOptionsKeys = Object.keys(options ?? {}).sort()
          report.handlerThis = this === ctx
            ? 'registered-ctx'
            : (this === ctx.llm ? 'llm-runtime' : (this?.constructor?.name ?? typeof this))
          report.handlerNextType = typeof next
          return (async function* () {
            // 按 model 切换短路形态，一次探针覆盖三种"最小合法流"。
            if (options?.model === 'empty') return
            if (options?.model === 'finish-only') {
              yield { type: 'finish', reason: { kind: 'stop' } }
              return
            }
            yield { type: 'text-delta', index: 0, text: BLOCKED_TEXT }
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
        { global: true, prepend: true },
      )
    },
    MODULE_BASE,
  )

  const llm = host.llm
  report.llmServicePresent = llm !== undefined
  report.providers = llm.listProviders().map((p) => p.id)

  // 假 adapter：`stream()` 是唯一抽象方法；`providerRetryPolicy` 在注册时必被调用，
  // `prepareCall` 在真实调用链上必被调用 —— 两者都不是可选项（普通对象没有原型默认实现）。
  // 短路成立时 `stream()` 一次都不该被调用。
  const probeAdapter = {
    providerInfo: (provider) => ({
      id: provider,
      name: provider,
      models: [{ id: 'probe-model', name: 'probe-model' }],
    }),
    providerRetryPolicy: () => undefined,
    resolveModel: async (provider, model) => ({ provider, id: model, name: model }),
    prepareCall: async (provider, model) => ({
      model: { provider, id: model, name: model },
      stream: (options) => probeAdapter.stream(options),
    }),
    stream: () => {
      report.adapterStreamCalls += 1
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: '[adapter-reached]' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  llm.registerAdapter(['probe-gate'], probeAdapter)
  report.providersAfterRegister = llm.listProviders().map((p) => p.id)

  // ── 探针 A：短路流（text-delta + finish）──────────────────────────────
  const shorted = await drain(llm.stream(REQUEST))
  probes.shortCircuit = {
    error: shorted.error,
    chunks: shorted.chunks,
    adapterStreamCalls: report.adapterStreamCalls,
    handlerCalls: report.handlerCalls,
  }
  probes.downstreamAssembly = assemble(shorted.chunks)

  // ── 探针 B：只 yield finish / 完全空流（最小形态是否被接受）──────────
  const finishOnly = await drain(llm.stream({ ...REQUEST, model: 'finish-only' }))
  probes.finishOnly = {
    error: finishOnly.error,
    chunkTypes: finishOnly.chunks.map((chunk) => chunk.type),
    assembly: assemble(finishOnly.chunks),
  }
  const empty = await drain(llm.stream({ ...REQUEST, model: 'empty' }))
  probes.emptyStream = {
    error: empty.error,
    chunkTypes: empty.chunks.map((chunk) => chunk.type),
    assembly: assemble(empty.chunks),
  }

  // ── 探针 C（反证）：摘掉 handler，adapter 必须恢复被调用 ──────────────
  detachHandler()
  const beforeBaseline = report.adapterStreamCalls
  const baseline = await drain(llm.stream(REQUEST))
  probes.adapterFallbackReached = {
    error: baseline.error,
    chunks: baseline.chunks,
    adapterStreamCallsDelta: report.adapterStreamCalls - beforeBaseline,
  }
} finally {
  try {
    await host?.fiber.dispose()
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

console.log(JSON.stringify({ report, probes }, null, 2))

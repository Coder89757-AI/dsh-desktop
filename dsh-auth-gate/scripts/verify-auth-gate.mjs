/**
 * Auth Gate 的自检脚本（headless，秒级，不需要 GUI / API key / 真实服务器）。
 *
 * 分两部分：
 *
 *   A. **纯逻辑断言** —— 直接 import 插件的 lib 模块，验证配置归一化、闸门形态
 *      映射、端点安全约束、响应字段抽取、状态机语义。这部分不需要 Host。
 *
 *   B. **端到端** —— 起一个假授权服务器（本机 http），再 boot 一个最小 Host
 *      （credentials-local + host-webserver + auth-gate），走完整链路：
 *
 *        未登录 → 登录（成功 / 失败）→ 落盘（**只落 refresh token**）→
 *        重启续期（自动进系统）→ 服务器不可达（离线阻断）→ 登出 → 来源校验
 *
 *  全程在**临时 DSH_HOME** 下进行，绝不触碰用户真实的 `~/.dsh`。
 *
 * 用法：
 *   node dsh-auth-gate/scripts/verify-auth-gate.mjs
 *   KEEP_PROBE_HOME=1 node ...   # 保留临时目录以便人工翻看落盘文件
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { API_PREFIX, AUTH_STATUS, GATE_MODE, normalizeConfig } from '../lib/constants.js'
import { OVERLAY_ENTRY_ID, ROOT_SHADOW_PRIORITY, describeGateMode, resolveGateTarget } from '../lib/gate-mode.js'
import { extractSession, resolveEndpoint, statusForFailure } from '../lib/login-client.js'
import { normalizeSessionPayload } from '../lib/session.js'
import { REASON, createAuthStore } from '../lib/state.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const AUTH_GATE_ENTRY = pathToFileURL(join(HERE, '..', 'lib', 'index.js')).href

/** 从 desktop 包的 node_modules 解析上游依赖（本包刻意零依赖，自己没有 node_modules）。 */
const requireFromDesktop = createRequire(join(REPO_ROOT, 'dsh-plugin-desktop', 'package.json'))
const { boot } = await import(pathToFileURL(requireFromDesktop.resolve('@deepseek-ai/dsh-app-boot')).href)
const { BlockAssembler } = await import(pathToFileURL(requireFromDesktop.resolve('@deepseek-ai/dsh-llm')).href)

const checks = []
const check = (name, pass, detail) => { checks.push({ name, pass: pass === true, detail }) }
const eq = (name, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  check(name, pass, pass ? actual : { actual, expected })
}

// ═══════════════════════════════════════════════════════ A. 纯逻辑断言

// ── A1. 闸门形态开关 ────────────────────────────────────────────────────
eq('gateTarget: overlay 注册到 shell.overlay', resolveGateTarget(GATE_MODE.OVERLAY), {
  name: 'shell.overlay',
  id: OVERLAY_ENTRY_ID,
  order: -1000,
})
eq('gateTarget: root-shadow 注册到 root 且 priority<0', resolveGateTarget(GATE_MODE.ROOT_SHADOW), {
  name: 'root',
  priority: ROOT_SHADOW_PRIORITY,
})
check('gateTarget: root 遮蔽的 priority 必须为负', ROOT_SHADOW_PRIORITY < 0, ROOT_SHADOW_PRIORITY)

// 这条是回归测试：注册 root 时一旦带上 children 会直接抛
// `slot "X" is already declared`。两个形态的注册参数都不许出现 children。
check(
  'gateTarget: 两种形态都不携带 children（否则 root 注册会抛错）',
  !('children' in resolveGateTarget(GATE_MODE.OVERLAY)) && !('children' in resolveGateTarget(GATE_MODE.ROOT_SHADOW)),
  { overlay: Object.keys(resolveGateTarget(GATE_MODE.OVERLAY)), rootShadow: Object.keys(resolveGateTarget(GATE_MODE.ROOT_SHADOW)) },
)
check('gateMode: 未配置时默认 overlay', normalizeConfig({}).gateMode === GATE_MODE.OVERLAY, normalizeConfig({}).gateMode)
check('gateMode: 非法值回落 overlay', normalizeConfig({ gateMode: 'nonsense' }).gateMode === GATE_MODE.OVERLAY)
check('gateMode: root-shadow 被接受', normalizeConfig({ gateMode: GATE_MODE.ROOT_SHADOW }).gateMode === GATE_MODE.ROOT_SHADOW)
check('gateMode: describeGateMode 覆盖两种形态', [GATE_MODE.OVERLAY, GATE_MODE.ROOT_SHADOW]
  .every((mode) => typeof describeGateMode(mode).strength === 'string'))

// ── A2. 配置归一化 ─────────────────────────────────────────────────────
{
  const config = normalizeConfig({ timeoutMs: 'abc', paths: { login: '/x/login' } })
  check('config: 非法 timeout 回落默认', config.timeoutMs === 5000, config.timeoutMs)
  check('config: 部分 paths 与默认合并', config.paths.login === '/x/login' && config.paths.verify === '/api/auth/verify', config.paths)
  check('config: allowHttp 默认关闭（只允许 https）', normalizeConfig({}).allowHttp === false)
  check('config: 垃圾输入不抛错', normalizeConfig(null).gateMode === GATE_MODE.OVERLAY)
}

// ── A3. 端点解析的安全约束 ─────────────────────────────────────────────
const endpointCases = [
  ['https 正常地址', { address: 'https://auth.example.com', path: '/api/auth/login', options: {} }, true],
  ['http 默认被拒（强制 https）', { address: 'http://auth.example.com', path: '/login', options: {} }, 'address-insecure'],
  ['http 显式放行', { address: 'http://auth.example.com', path: '/login', options: { allowHttp: true } }, true],
  ['file: 被拒', { address: 'file:///etc/passwd', path: '/x', options: { allowHttp: true } }, 'address-scheme'],
  ['gopher: 被拒', { address: 'gopher://evil.test', path: '/x', options: { allowHttp: true } }, 'address-scheme'],
  ['URL 内嵌凭据被拒', { address: 'https://u:p@auth.example.com', path: '/x', options: {} }, 'address-userinfo'],
  ['空地址', { address: '   ', path: '/x', options: {} }, 'address-missing'],
  ['非 URL', { address: '不是地址', path: '/x', options: {} }, 'address-invalid'],
]
for (const [label, params, expected] of endpointCases) {
  const result = resolveEndpoint(params.address, params.path, params.options)
  if (expected === true) {
    check(`endpoint: ${label}`, result.ok === true, result)
  } else {
    check(`endpoint: ${label}`, result.ok === false && result.failure === expected, result)
  }
}
// 基址带路径时不能把用户的路径吃掉，也不能产生双斜杠
{
  const result = resolveEndpoint('https://auth.example.com/base/', '/api/auth/login', {})
  check('endpoint: 基址与路径拼接规范', result.ok === true && result.url === 'https://auth.example.com/base/api/auth/login', result)
}

// ── A4. 响应字段抽取 ───────────────────────────────────────────────────
{
  const fields = normalizeConfig({}).fields
  const seconds = extractSession({ token: 'T', refreshToken: 'R', expiresIn: 3600, user: { name: 'alice' } }, fields)
  check('extract: expiresIn 秒 → 毫秒（相对当前时间）',
    seconds.token === 'T' && seconds.refreshToken === 'R' && seconds.username === 'alice'
    && typeof seconds.expiresAt === 'number' && Math.abs(seconds.expiresAt - (Date.now() + 3_600_000)) < 5000,
    seconds)
  const iso = extractSession({ token: 'T', expiresIn: '2030-01-01T00:00:00.000Z' }, fields)
  check('extract: ISO 时间串', iso.expiresAt === Date.parse('2030-01-01T00:00:00.000Z'), iso)
  const missing = extractSession({}, fields)
  check('extract: 缺字段时返回 null 而不是抛错', missing.token === null && missing.refreshToken === null, missing)
  const custom = extractSession({ access_token: 'T2' }, { ...fields, token: 'access_token' })
  check('extract: 字段映射可配（协议不匹配只改配置）', custom.token === 'T2', custom)
}

// ── A5. 失败原因 → 授权状态（离线阻断的落点）──────────────────────────
eq('failure: transport → unreachable', statusForFailure({ failure: 'transport' }), AUTH_STATUS.UNREACHABLE)
eq('failure: server-error → unreachable', statusForFailure({ failure: 'server-error' }), AUTH_STATUS.UNREACHABLE)
eq('failure: rejected → unauthenticated', statusForFailure({ failure: 'rejected' }), AUTH_STATUS.UNAUTHENTICATED)
eq('failure: malformed → unauthenticated', statusForFailure({ failure: 'malformed' }), AUTH_STATUS.UNAUTHENTICATED)

// ── A6. 状态机 fail-closed ─────────────────────────────────────────────
{
  const store = createAuthStore()
  check('state: 初始态是 checking（不是乐观放行）', store.get().status === AUTH_STATUS.CHECKING, store.get().status)
  check('state: checking 不算已授权', store.isAuthorized() === false)
  store.patch({ status: AUTH_STATUS.AUTHENTICATED })
  check('state: authenticated 才算已授权', store.isAuthorized() === true)

  store.setAccessToken('SECRET-ACCESS-TOKEN')
  check('state: access token 只存内存', store.getAccessToken() === 'SECRET-ACCESS-TOKEN')
  check('state: access token 不出现在公开快照里',
    !JSON.stringify(store.get()).includes('SECRET-ACCESS-TOKEN'), store.get())
  store.setAccessToken(null)
  check('state: 清除后为 null', store.getAccessToken() === null)
}

// ── A7. 凭据载荷的防御性解析 ───────────────────────────────────────────
{
  check('payload: 正常载荷通过',
    normalizeSessionPayload({ serverAddress: 'https://a.test', username: 'u', refreshToken: 'r' })?.refreshToken === 'r')
  check('payload: 缺 serverAddress → null', normalizeSessionPayload({ username: 'u' }) === null)
  check('payload: 非对象 → null', normalizeSessionPayload('nope') === null)
  check('payload: 垃圾不抛错', normalizeSessionPayload({ serverAddress: 1, username: null }) === null)
}

// ═══════════════════════════════════════════════════════ B. 端到端

/** 假授权服务器：只实现契约里约定的三个端点。 */
function startFakeAuthServer() {
  const state = { logins: 0, refreshes: 0, seenPasswords: [] }
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0]
      const send = (status, payload) => {
        const text = JSON.stringify(payload)
        res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
        res.end(text)
      }
      if (path === '/api/auth/login' && req.method === 'POST') {
        const parsed = safeJson(body)
        state.logins += 1
        state.seenPasswords.push(parsed?.password)
        if (parsed?.username === 'alice' && parsed?.password === 'correct-horse') {
          send(200, {
            token: `ACCESS-${state.logins}`,
            refreshToken: `REFRESH-${state.logins}`,
            expiresIn: 3600,
            user: { name: 'alice' },
          })
          return
        }
        send(401, { code: 'BAD_CREDENTIALS' })
        return
      }
      if (path === '/api/auth/refresh' && req.method === 'POST') {
        const parsed = safeJson(body)
        state.refreshes += 1
        if (typeof parsed?.refreshToken === 'string' && parsed.refreshToken.startsWith('REFRESH-')) {
          send(200, { token: `ACCESS-R${state.refreshes}`, refreshToken: `REFRESH-R${state.refreshes}`, expiresIn: 3600 })
          return
        }
        send(401, { code: 'BAD_REFRESH' })
        return
      }
      if (path === '/api/auth/logout' && req.method === 'POST') {
        send(200, { ok: true })
        return
      }
      send(404, { code: 'NOT_FOUND' })
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, state }))
  })
}

const safeJson = (text) => { try { return JSON.parse(text) } catch { return null } }

const home = mkdtempSync(join(tmpdir(), 'dsh-auth-gate-verify-'))
process.env.DSH_HOME = home
const rootConfig = join(home, 'root.yml')
writeFileSync(rootConfig, '[]\n')

const MODULE_BASE = pathToFileURL(join(REPO_ROOT, 'dsh-plugin-desktop', 'package.json')).href
const credentialsFile = join(home, '.credentials.yaml')

/**
 * 假 LLM 适配器。
 *
 * `stream()` 是唯一抽象方法；`providerRetryPolicy` 在注册时必被调用，
 * `resolveModel` / `prepareCall` 在真实调用链上必被调用 —— 都不是可选项
 * （普通对象没有原型默认实现）。闸门短路成立时 `stream()` 一次都不该被调用，
 * 这正好是我们要断言的东西。
 */
let probeAdapterCalls = 0
const probeAdapter = {
  providerInfo: (provider) => ({ id: provider, name: provider, models: [{ id: 'probe-model', name: 'probe-model' }] }),
  providerRetryPolicy: () => undefined,
  resolveModel: async (provider, model) => ({ provider, id: model, name: model }),
  prepareCall: async (provider, model) => ({
    model: { provider, id: model, name: model },
    stream: (options) => probeAdapter.stream(options),
  }),
  stream: () => {
    probeAdapterCalls += 1
    return (async function* () {
      yield { type: 'text-delta', index: 0, text: '[adapter-reached]' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()
  },
}

/** 用 BlockAssembler 组装一条流，验证下游消费者能不能吃下。 */
function assembleStream(chunks) {
  try {
    const assembler = new BlockAssembler()
    for (const chunk of chunks) assembler.push(chunk)
    return { blocks: assembler.blocks(), finish: assembler.finish, error: null }
  } catch (error) {
    return { blocks: null, finish: null, error: `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}` }
  }
}

/** 把一条流里的文本 delta 拼起来。 */
const streamText = (chunks) => chunks
  .filter((chunk) => chunk.type === 'text-delta')
  .map((chunk) => chunk.text)
  .join('')

/** 收一条 chunk 流。 */
async function drain(iterable) {
  const chunks = []
  try {
    for await (const chunk of iterable) chunks.push(chunk)
    return { chunks, error: null }
  } catch (error) {
    return { chunks, error: `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}` }
  }
}

/**
 * 起一个最小 Host：只插待测的四行，不带 desktop profile
 * （desktop profile 会拉进需要 Electron 服务的行）。
 *
 * `llm` 行是给闸门验证用的：没有它就没法证明"未授权时模型调用被短路、
 * 已授权时放行到适配器"。
 */
async function bootHost(serverAddress) {
  probeAdapterCalls = 0
  const host = await boot(
    'dsh-auth-gate-verify',
    rootConfig,
    [{ insert: [
      { id: 'credentials-local', name: '@deepseek-ai/dsh-credentials-local' },
      { id: 'webserver', name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } },
      { id: 'llm', name: '@deepseek-ai/dsh-llm' },
      {
        id: 'auth-gate',
        name: AUTH_GATE_ENTRY,
        config: { gateMode: 'overlay', allowHttp: true, serverAddress, timeoutMs: 3000 },
      },
    ] }],
    () => {},
    MODULE_BASE,
  )

  // 适配器在 boot 之后再注册，且**不加可选链**：如果 llm 服务不在，这里必须
  // 直接抛错。之前写在 provideFn 里并写成 `ctx.llm?.registerAdapter(...)`，
  // 那个可选链会把"没注册上"变成一个静默的空操作，让闸门的放行断言假失败。
  host.llm.registerAdapter(['probe-gate'], probeAdapter)
  return host
}

/** 一次模型调用请求，供闸门测试使用。 */
const PROBE_REQUEST = { provider: 'probe-gate', model: 'probe-model', messages: [] }

/** 读一次插件暴露的公开状态。 */
async function readState(port, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${API_PREFIX}/state`, { headers, cache: 'no-store' })
  let payload = null
  try { payload = await response.json() } catch {}
  return { status: response.status, payload }
}

/**
 * 用裸 `node:http` 发一次 GET。
 *
 * 存在的理由只有一个：**只有它能伪造 `Host` 头**。`fetch`（undici）把 `Host`
 * 列为禁止修改的请求头，传进去会被静默忽略 —— 用它测来源校验会得到一个
 * 假通过的结果。连接目标仍写死 127.0.0.1，只改头。
 */
function rawGet(port, path, headers) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (response) => {
      let body = ''
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        let payload = null
        try { payload = JSON.parse(body) } catch {}
        resolve({ status: response.statusCode, payload })
      })
    })
    request.on('error', reject)
    request.end()
  })
}

/** POST 一个动作。 */
async function post(port, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${API_PREFIX}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  let payload = null
  try { payload = await response.json() } catch {}
  return { status: response.status, payload }
}

const report = { home, checks, endToEnd: {} }
let auth
let host

try {
  auth = await startFakeAuthServer()
  const address = `http://127.0.0.1:${auth.port}`
  report.endToEnd.simulatedServer = address

  // ── B1. 无记录启动 ───────────────────────────────────────────────────
  host = await bootHost(address)
  const port = host.webServer?.port
  report.endToEnd.webServerPort = port
  check('e2e: webServer 起来了', typeof port === 'number' && port > 0, port)

  const initial = await readState(port)
  check('e2e: 无记录时状态为 unauthenticated', initial.payload?.state?.status === AUTH_STATUS.UNAUTHENTICATED, initial.payload)
  check('e2e: 无记录时原因是 no-record', initial.payload?.state?.reason === REASON.NO_RECORD, initial.payload?.state?.reason)
  check('e2e: 状态响应里不含任何 token', !JSON.stringify(initial.payload).includes('ACCESS-'), initial.payload)

  // ── B2. 来源校验 ─────────────────────────────────────────────────────
  // 伪造一个非 loopback 的 Host 头（DNS rebinding 的典型形态）：
  // 连接仍然是打到 127.0.0.1，但 Host 声称是别的域名 —— 插件应当 403。
  //
  // 这里**必须用裸 http.request**：fetch/undici 把 `Host` 列为禁止修改的请求头，
  // 用 fetch 传 `headers: { host }` 会被静默忽略，测试会假通过。
  const foreign = await rawGet(port, `${API_PREFIX}/state`, { host: 'evil.example.com' })
  check('e2e: 伪造 Host 头（DNS rebinding 形态）被 403 拒绝', foreign.status === 403, foreign)
  const loopbackHost = await rawGet(port, `${API_PREFIX}/state`, { host: `127.0.0.1:${port}` })
  check('e2e: 合法 loopback Host 头正常放行（对照组）', loopbackHost.status === 200, loopbackHost.status)

  // ── B3. 密码错误 ─────────────────────────────────────────────────────
  const badLogin = await post(port, '/login', { username: 'alice', password: 'wrong' })
  check('e2e: 密码错误被拒', badLogin.status === 401 && badLogin.payload?.failure === 'rejected', badLogin.payload)
  check('e2e: 密码错误后仍是未授权', badLogin.payload?.state?.status === AUTH_STATUS.UNAUTHENTICATED, badLogin.payload?.state)

  // ── B4. 登录成功 ─────────────────────────────────────────────────────
  const login = await post(port, '/login', { username: 'alice', password: 'correct-horse' })
  check('e2e: 登录成功', login.status === 200 && login.payload?.ok === true, login.payload)
  check('e2e: 登录后状态为 authenticated', login.payload?.state?.status === AUTH_STATUS.AUTHENTICATED, login.payload?.state)
  check('e2e: 登录响应不回传 token', !JSON.stringify(login.payload).includes('ACCESS-'), login.payload)

  // ── B5. 落盘形态（C 方案的核心断言）──────────────────────────────────
  const persisted = existsSync(credentialsFile) ? readFileSync(credentialsFile, 'utf8') : ''
  report.endToEnd.credentialsFilePreview = persisted
  check('e2e: 凭据已落盘', persisted !== '')
  check('e2e: 落盘含 refresh token', persisted.includes('REFRESH-'))
  check('e2e: 落盘**不含** access token（C 方案）', !persisted.includes('ACCESS-'), persisted.slice(0, 400))
  check('e2e: 落盘不含密码', !persisted.includes('correct-horse'), persisted.slice(0, 400))
  check('e2e: 落盘记录了服务器地址与用户名',
    persisted.includes('alice') && persisted.includes('127.0.0.1'), persisted.slice(0, 400))

  // ── B6. 登出 ─────────────────────────────────────────────────────────
  const logout = await post(port, '/logout')
  check('e2e: 登出成功', logout.status === 200 && logout.payload?.ok === true, logout.payload)
  check('e2e: 登出后回到未授权', logout.payload?.state?.status === AUTH_STATUS.UNAUTHENTICATED, logout.payload?.state)
  check('e2e: 登出后凭据文件里不再有 refresh token',
    !readFileSync(credentialsFile, 'utf8').includes('REFRESH-'), readFileSync(credentialsFile, 'utf8').slice(0, 300))

  // ── B6b. Host 闸门：未授权时 `llm/stream` 必须短路 ───────────────────
  // 上一步刚登出，此刻状态是 unauthenticated。这是"未登录不让模型工作"的实质：
  // 适配器必须一次都不被调用，而用户要能看到一句可读的拒绝理由。
  check('e2e: 假 LLM 适配器已注册（否则本组断言毫无意义）',
    host.llm.listProviders().some((provider) => provider.id === 'probe-gate'),
    host.llm.listProviders().map((provider) => provider.id))

  const blockedStream = await drain(host.llm.stream(PROBE_REQUEST))
  const blockedText = streamText(blockedStream.chunks)
  check('e2e: 未授权时 llm/stream 短路，适配器零调用', probeAdapterCalls === 0, probeAdapterCalls)
  check('e2e: 短路流返回可读的拒绝理由（不是空流）',
    blockedText.length > 0 && blockedText.includes('授权'), blockedText)
  check('e2e: 短路流里没有适配器的内容', !blockedText.includes('[adapter-reached]'), blockedText)
  check('e2e: 短路流能被下游 BlockAssembler 正常组装（无错误）',
    assembleStream(blockedStream.chunks).blocks?.some((block) => block.text === blockedText) === true,
    assembleStream(blockedStream.chunks))

  // ── B6c. 授权后必须放行到适配器（反证闸门不是"永远拦住"）────────────
  await post(port, '/login', { username: 'alice', password: 'correct-horse' })
  const allowedStream = await drain(host.llm.stream(PROBE_REQUEST))
  const allowedDetail = {
    adapterCalls: probeAdapterCalls,
    error: allowedStream.error,
    chunkTypes: allowedStream.chunks.map((chunk) => chunk.type),
    text: streamText(allowedStream.chunks),
  }
  check('e2e: 已授权时放行，适配器恰好被调用一次', probeAdapterCalls === 1, allowedDetail)
  check('e2e: 放行后拿到的是适配器的内容',
    streamText(allowedStream.chunks).includes('[adapter-reached]'), allowedDetail)

  // ── B7. 重启续期：先登录再把 Host 完整重启一遍 ────────────────────────
  await post(port, '/login', { username: 'alice', password: 'correct-horse' })
  await host.fiber.dispose()
  host = await bootHost(address)
  const port2 = host.webServer?.port
  // bootstrap 是异步的，给它一点时间落定。
  const renewed = await waitForState(port2, AUTH_STATUS.AUTHENTICATED, 5000)
  check('e2e: 重启后用 refresh token 自动续期进入已授权', renewed?.state?.status === AUTH_STATUS.AUTHENTICATED, renewed)
  check('e2e: 续期确实打到了服务端的 refresh 端点', auth.state.refreshes > 0, auth.state.refreshes)

  // ── B8. 服务器不可达 → 离线阻断 ──────────────────────────────────────
  const brokenPort = auth.port
  auth.server.close()
  await host.fiber.dispose()
  host = await bootHost(`http://127.0.0.1:${brokenPort}`)
  const blocked = await waitForState(host.webServer?.port, AUTH_STATUS.UNREACHABLE, 8000)
  check('e2e: 服务器不可达时状态是 unreachable（不是 unauthenticated）',
    blocked?.state?.status === AUTH_STATUS.UNREACHABLE, blocked?.state)
  check('e2e: 不可达时保留本地记录（服务器恢复后无需重输密码）',
    readFileSync(credentialsFile, 'utf8').includes('REFRESH-'), null)
} catch (error) {
  report.fatal = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`
  report.fatalStack = String(error?.stack ?? '').split('\n').slice(0, 10)
} finally {
  try { await host?.fiber.dispose() } catch {}
  try { auth?.server.close() } catch {}
}

/** 轮询公开状态直到命中期望值或超时。 */
async function waitForState(port, expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    const result = await readState(port)
    last = result.payload
    if (result.payload?.state?.status === expected) return result.payload
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return last
}

const failed = checks.filter((entry) => entry.pass !== true)
report.summary = { total: checks.length, passed: checks.length - failed.length, failed: failed.length }

console.log(JSON.stringify(report, null, 2))

if (process.env.KEEP_PROBE_HOME === '1') console.log(`\n[kept] verify home: ${home}`)
else rmSync(home, { recursive: true, force: true })

process.exit(failed.length === 0 ? 0 : 1)

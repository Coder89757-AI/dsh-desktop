/**
 * Auth Gate — Host 半边。
 *
 * 启动时序（fail-closed）：
 *
 *   插件加载
 *     ├─ 立即注册两道 Host 闸门（此时状态是 `checking`，闸门视为未授权 → 拒绝）
 *     ├─ 注册同源 HTTP 路由（渲染器靠它拿状态、提交登录）
 *     └─ bootstrap()：读凭据记录 → 续期 → 判定状态
 *           ├─ 成功      → authenticated（闸门自动放行）
 *           ├─ 凭据失效  → unauthenticated
 *           └─ 连不上    → unreachable（离线阻断策略）
 *
 * **闸门只注册一次，永不注销。** 这一点与评估文档最初设想的"登录后注销闸门注册"
 * 不同，是刻意的：注册/注销会产生一个"注销失败就永久开门"的失败模式，而把授权
 * 判断放进 handler 内部之后，运行期 token 失效可以**立即**重新上闸（改状态即可），
 * 不需要任何注册动作。闸门读状态，状态是唯一真相。
 *
 * `checking` 也走拒绝分支 —— 这是本插件最重要的一个决定：从进程起来到服务端
 * 给出结论之间存在一个窗口，那个窗口里必须是什么都不能做，而不是"先放行再说"。
 */

import {
  API_PREFIX,
  AUTH_STATUS,
  DEFAULT_DENY_MESSAGE,
  TOOL_DENY_REASON,
  normalizeConfig,
} from './constants.js'
import {
  extractSession,
  login as loginRequest,
  logout as logoutRequest,
  refresh as refreshRequest,
  resolveEndpoint,
  statusForFailure,
} from './login-client.js'
import { clearSession, readSession, writeSession } from './session.js'
import { REASON, createAuthStore } from './state.js'

export { AUTH_STATUS, CREDENTIAL_KEY, GATE_MODE } from './constants.js'
export { REASON } from './state.js'
export { readSession, writeSession, clearSession, describeSession } from './session.js'

export const name = 'dsh-auth-gate'

/**
 * `credentials` 是硬依赖：没有它这个插件没有任何意义。
 * `tools` / `webServer` / `llm` 用嵌套 inject 等 —— 这样同一份代码也能跑在
 * 没有 webServer 的环境里（CLI），而不是加载失败。
 */
export const inject = ['credentials']

/** HTTP 请求体上限。登录请求只有三个字段，正常远小于这个数。 */
const MAX_BODY_BYTES = 16 * 1024

/**
 * Cordis 插件入口。
 *
 * @param {object} ctx - Cordis Context（已满足 {@link inject}）。
 * @param {object} [rawConfig] - Loader 行上的 `config`。
 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const store = createAuthStore()

  /** 只记状态变化，**永不记 token / 密码**。 */
  const log = (level, message, detail) => {
    const logger = ctx.logger
    if (typeof logger?.[level] !== 'function') return
    if (detail === undefined) logger[level](`[auth-gate] ${message}`)
    else logger[level](`[auth-gate] ${message}`, detail)
  }

  // ---------------------------------------------------------------- 闸门一：模型调用
  // 未授权时不调 next()，直接交回一条可读的拒绝理由 —— 适配器一次都不会被调用。
  // 已实测：下游 BlockAssembler 会把 text-delta 正常组装成文本块，无错误。
  // 注意 handler 里的 `this` 是 LlmRuntime 而不是 ctx，所以状态一律走闭包里的 store。
  ctx.effect(
    () => ctx.on('llm/stream', function authGateLlmStream(_options, next) {
      if (store.isAuthorized()) return next()
      return (async function* denied() {
        yield { type: 'text-delta', index: 0, text: DEFAULT_DENY_MESSAGE }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    }, { global: true, prepend: true }),
    'auth-gate: llm/stream gate',
  )

  // ---------------------------------------------------------------- 闸门二：工具调用
  // 单调守卫：返回字符串即拒绝，且任何插件都无法把它翻盘成允许。
  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.effect(
      () => toolCtx.tools.guard(() => (store.isAuthorized() ? undefined : TOOL_DENY_REASON)),
      'auth-gate: tool guard',
    )
  })

  // ---------------------------------------------------------------- 同源 HTTP 面
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: (req, res) => handleHttp(req, res),
      }),
      'auth-gate: http routes',
    )
  })

  // ---------------------------------------------------------------- 启动校验
  let bootstrapInFlight = null

  /** 触发一次启动校验（并发去重）。 */
  const bootstrap = () => {
    if (bootstrapInFlight) return bootstrapInFlight
    bootstrapInFlight = runBootstrap().finally(() => { bootstrapInFlight = null })
    return bootstrapInFlight
  }

  bootstrap()

  // ---------------------------------------------------------------- 业务编排

  /**
   * 启动校验：读记录 → 续期 → 判定状态。
   *
   * 离线阻断策略的落点：只要服务器在续期这一步不可达，状态就是 `unreachable`，
   * 不进入应用。**本地 `expiresAt` 不参与放行判断** —— 每次启动都必须触达服务端。
   *
   * @returns {Promise<void>} 校验完成（不抛错：失败一律转化为状态）。
   */
  async function runBootstrap() {
    let session = null
    try {
      session = await readSession(ctx.credentials)
    } catch (error) {
      // 存储层故障（IO / 锁超时）不该让插件崩掉，但也不能当作"已登录"。
      log('error', 'failed to read the credential record; treating as unauthenticated', error)
      store.patch({ status: AUTH_STATUS.UNAUTHENTICATED, reason: REASON.ERROR, checkedAt: Date.now() })
      return
    }

    if (session === null) {
      store.patch({ status: AUTH_STATUS.UNAUTHENTICATED, reason: REASON.NO_RECORD, checkedAt: Date.now() })
      return
    }

    store.patch({
      username: session.username,
      serverAddress: session.serverAddress,
      expiresAt: session.expiresAt,
    })

    if (session.refreshToken === null) {
      // C 方案：access token 只在内存，重启即丢。没有 refresh token 就没法续期，
      // 只能回到登录页 —— 这是服务端必须支持 refresh 的原因，见 README。
      log('warn', 'stored record has no refresh token; the user must sign in again after a restart')
      store.patch({ status: AUTH_STATUS.UNAUTHENTICATED, reason: REASON.EXPIRED, checkedAt: Date.now() })
      return
    }

    const endpoint = resolveEndpoint(session.serverAddress, config.paths.refresh, config)
    if (!endpoint.ok) {
      log('warn', `stored server address is unusable (${endpoint.failure})`)
      store.patch({ status: AUTH_STATUS.UNAUTHENTICATED, reason: REASON.ERROR, checkedAt: Date.now() })
      return
    }

    const result = await refreshRequest({
      url: endpoint.url,
      refreshToken: session.refreshToken,
      timeoutMs: config.timeoutMs,
    })

    if (!result.ok) {
      const status = statusForFailure(result)
      if (status === AUTH_STATUS.UNREACHABLE) {
        // 服务器不可达 → 阻断。刻意保留记录：服务器恢复后下次启动能自动进去，
        // 用户不需要重新输密码。
        log('warn', 'authorization server is unreachable; the gate stays closed')
        store.patch({ status, reason: REASON.UNREACHABLE, checkedAt: Date.now() })
        return
      }
      // refresh token 被服务端否定 —— 记录已经没用了，清掉避免下次再白跑一趟。
      await clearSession(ctx.credentials).catch(() => {})
      store.patch({ status: AUTH_STATUS.UNAUTHENTICATED, reason: REASON.EXPIRED, checkedAt: Date.now() })
      return
    }

    const renewed = extractSession(result.data, config.fields)
    if (renewed.token === null) {
      log('warn', 'refresh response carried no token; check the `fields` mapping')
      store.patch({ status: AUTH_STATUS.UNAUTHENTICATED, reason: REASON.ERROR, checkedAt: Date.now() })
      return
    }

    store.setAccessToken(renewed.token)

    // 轮换 refresh token。写入走 modifyRecord（序列化读-改-写 + 跨进程锁），
    // 所以两个进程并发续期不会互相覆盖。
    if (renewed.refreshToken !== null && renewed.refreshToken !== session.refreshToken) {
      await writeSession(ctx.credentials, {
        serverAddress: session.serverAddress,
        username: session.username,
        refreshToken: renewed.refreshToken,
        expiresAt: renewed.expiresAt,
      }).catch((error) => log('warn', 'failed to rotate the refresh token', error))
    }

    store.patch({
      status: AUTH_STATUS.AUTHENTICATED,
      reason: null,
      expiresAt: renewed.expiresAt ?? session.expiresAt,
      checkedAt: Date.now(),
    })
    log('info', 'authorization verified against the server; the gate is open')
  }

  /**
   * 处理一次登录提交。
   *
   * 密码只作为局部变量活在这一段里：**不落盘、不进日志、不回传前端**。
   *
   * @param {object} body - 请求体 `{serverAddress?, username, password}`。
   * @returns {Promise<{ok: true} | {ok: false, failure: string}>} 结果。
   */
  async function handleLogin(body) {
    const username = typeof body?.username === 'string' ? body.username : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const address = typeof body?.serverAddress === 'string' && body.serverAddress.trim() !== ''
      ? body.serverAddress.trim()
      : config.serverAddress

    if (username === '' || password === '') return { ok: false, failure: 'credentials-missing' }

    const endpoint = resolveEndpoint(address, config.paths.login, config)
    if (!endpoint.ok) return { ok: false, failure: endpoint.failure }

    store.patch({ status: AUTH_STATUS.CHECKING, reason: null, serverAddress: address })

    const result = await loginRequest({
      url: endpoint.url,
      username,
      password,
      timeoutMs: config.timeoutMs,
    })

    if (!result.ok) {
      // 这里刻意不把服务端报文带回去：它可能含堆栈或内网地址。
      const status = statusForFailure(result)
      store.patch({
        status,
        reason: status === AUTH_STATUS.UNREACHABLE ? REASON.UNREACHABLE : REASON.REJECTED,
        checkedAt: Date.now(),
      })
      return { ok: false, failure: result.failure }
    }

    const session = extractSession(result.data, config.fields)
    if (session.token === null) {
      store.patch({ status: AUTH_STATUS.UNAUTHENTICATED, reason: REASON.ERROR, checkedAt: Date.now() })
      return { ok: false, failure: 'malformed' }
    }

    store.setAccessToken(session.token)
    if (session.refreshToken === null) {
      log('warn', 'the server returned no refresh token; this session will not survive a restart')
    }

    try {
      await writeSession(ctx.credentials, {
        serverAddress: address,
        username,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
      })
    } catch (error) {
      // 写盘失败不影响本次使用（access token 在内存里），但要如实告诉用户
      // "重启后要重新登录"，而不是假装成功。
      log('error', 'signed in but failed to persist the session record', error)
    }

    store.patch({
      status: AUTH_STATUS.AUTHENTICATED,
      reason: null,
      username: session.username ?? username,
      serverAddress: address,
      expiresAt: session.expiresAt,
      checkedAt: Date.now(),
    })
    return { ok: true }
  }

  /**
   * 登出：通知服务端（尽力而为）→ 清内存 → 清记录 → 回到未授权。
   *
   * @returns {Promise<void>} 完成。
   */
  async function handleLogout() {
    const snapshot = store.get()
    const token = store.getAccessToken()
    if (token !== null && snapshot.serverAddress) {
      const endpoint = resolveEndpoint(snapshot.serverAddress, config.paths.logout, config)
      if (endpoint.ok) await logoutRequest({ url: endpoint.url, token, timeoutMs: config.timeoutMs })
    }
    store.setAccessToken(null)
    await clearSession(ctx.credentials).catch((error) => log('warn', 'failed to clear the session record', error))
    store.patch({
      status: AUTH_STATUS.UNAUTHENTICATED,
      reason: REASON.LOGOUT,
      expiresAt: null,
      checkedAt: Date.now(),
    })
  }

  // ---------------------------------------------------------------- HTTP 处理

  /**
   * 路由分发。
   *
   * @param {import('node:http').IncomingMessage} req - 请求。
   * @param {import('node:http').ServerResponse} res - 响应。
   * @returns {Promise<void>} 完成。
   */
  async function handleHttp(req, res) {
    // 纵深防御：桌面自带的 BrowserAuth（launch token → 签名 cookie）已经在载波层
    // 做了鉴权，但本端点不依赖它，自己再判一次来源。
    if (!isLoopbackRequest(req)) {
      sendJson(res, 403, { ok: false, failure: 'forbidden' })
      return
    }

    const path = (req.url ?? '').split('?')[0].replace(/\/$/u, '')

    try {
      if (path === `${API_PREFIX}/state` && req.method === 'GET') {
        sendJson(res, 200, { ok: true, state: publicState() })
        return
      }
      if (path === `${API_PREFIX}/settings` && req.method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          settings: { serverAddress: config.serverAddress, allowHttp: config.allowHttp, gateMode: config.gateMode },
          state: publicState(),
        })
        return
      }
      if (path === `${API_PREFIX}/refresh-check` && req.method === 'POST') {
        await bootstrap()
        sendJson(res, 200, { ok: true, state: publicState() })
        return
      }
      if (path === `${API_PREFIX}/login` && req.method === 'POST') {
        const body = await readJsonBody(req)
        if (body === null) {
          sendJson(res, 400, { ok: false, failure: 'bad-request' })
          return
        }
        const result = await handleLogin(body)
        sendJson(res, result.ok ? 200 : 401, { ...result, state: publicState() })
        return
      }
      if (path === `${API_PREFIX}/logout` && req.method === 'POST') {
        await handleLogout()
        sendJson(res, 200, { ok: true, state: publicState() })
        return
      }
      sendJson(res, 404, { ok: false, failure: 'not-found' })
    } catch (error) {
      // 细节只进日志，不进响应。
      log('error', 'unhandled error while serving an auth-gate route', error)
      sendJson(res, 500, { ok: false, failure: 'internal' })
    }
  }

  /**
   * 组装给渲染器的公开状态。
   *
   * **绝不包含 token** —— 这条与上游 `CredentialsController` 的立场一致
   * （`no method here returns one`）。
   *
   * @returns {object} 公开状态。
   */
  function publicState() {
    const snapshot = store.get()
    return {
      status: snapshot.status,
      reason: snapshot.reason,
      username: snapshot.username,
      serverAddress: snapshot.serverAddress,
      expiresAt: snapshot.expiresAt,
      checkedAt: snapshot.checkedAt,
      /** 供界面提示"这是内存态凭据，重启后需重新认证"之类的判断。 */
      hasRefreshToken: snapshot.status === AUTH_STATUS.AUTHENTICATED,
    }
  }
}

// ------------------------------------------------------------------ HTTP 工具函数

/**
 * 只接受 loopback 来源。
 *
 * 照抄桌面自己的做法（`desktop-settings-route.ts` 校验 hostname ∈ `127.0.0.1` / `[::1]`）。
 * 主渲染器的 origin 就是 `http://127.0.0.1:<port>`，所以同源请求必然通过；
 * 而局域网内其它机器打过来的请求会被挡掉。
 *
 * @param {import('node:http').IncomingMessage} req - 请求。
 * @returns {boolean} 是否为可信的本机请求。
 */
function isLoopbackRequest(req) {
  const remote = req.socket?.remoteAddress ?? ''
  if (!isLoopbackAddress(remote)) return false

  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return false
  // Host 可能是 `127.0.0.1:12345` / `[::1]:12345` —— 去掉端口再判。
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  return isLoopbackAddress(hostname)
}

/**
 * 判断一个地址字面量是否是 loopback。
 *
 * @param {string} value - IPv4 / IPv6 / 主机名。
 * @returns {boolean} 是否为 loopback。
 */
function isLoopbackAddress(value) {
  const normalized = value.toLowerCase()
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]'
    || normalized === '::ffff:127.0.0.1'
    || normalized === 'localhost'
}

/**
 * 读一个 JSON 请求体（带大小上限）。
 *
 * @param {import('node:http').IncomingMessage} req - 请求。
 * @returns {Promise<object|null>} 解析后的对象；超限或非法时为 null。
 */
function readJsonBody(req) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        resolve(null)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(null)
        return
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(parsed && typeof parsed === 'object' ? parsed : null)
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

/**
 * 写一个 JSON 响应。
 *
 * @param {import('node:http').ServerResponse} res - 响应。
 * @param {number} status - HTTP 状态码。
 * @param {object} payload - 响应体。
 */
function sendJson(res, status, payload) {
  if (res.writableEnded) return
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

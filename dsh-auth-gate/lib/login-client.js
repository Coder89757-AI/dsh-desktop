/**
 * 对授权服务器的 HTTP 客户端。
 *
 * 这个文件是插件**自身**最危险的面：它拿着用户填的服务器地址、用户名和密码
 * 去发请求。威胁模型是"用户填错地址 / 填了一个恶意地址 / 服务器返回了带内网
 * 信息的报错"，而不是"攻击者从外部控制输入"—— 地址来自本机用户的配置界面。
 * 因此控制点落在协议白名单、不跟随重定向、超时，以及**错误信息不回显服务端报文**上。
 *
 * 刻意**不做**的三件事，以及原因：
 *
 * - **不屏蔽私网/回环 IP**。授权服务器本来就大概率在内网 —— 禁私网等于把这个
 *   插件废掉。真正要防的"跳到任意主机"由"不跟随重定向 + scheme 白名单"覆盖。
 * - **不提供任何跳过 TLS 校验的开关**（`rejectUnauthorized:false` / `--insecure` /
 *   `strict-ssl=false`）。证书有问题就去修证书，哪怕用户说"只是测试环境"。
 * - **不把服务端原始报文带回错误信息**。服务端报错里常带堆栈、内网 IP、甚至
 *   回显的请求体。我们只回一个稳定的原因码和（若是短字符串）服务端自己的 `code`。
 */

import { DEFAULT_CONFIG, AUTH_STATUS } from './constants.js'

/** 允许的协议。其它 scheme（`file:` / `gopher:` / `data:` …）一律拒绝。 */
const ALLOWED_PROTOCOLS = new Set(['https:', 'http:'])

/** 网络栈失败一律归一到这两个原因，避免把底层错误细节透出去。 */
const TRANSPORT_FAILURE = 'transport'

/**
 * 把服务器地址 + 路径解析成一个绝对端点。
 *
 * @param {string} serverAddress - 用户填写的基址，例如 `https://auth.corp.example`。
 * @param {string} path - 端点路径，例如 `/api/auth/login`。
 * @param {{allowHttp?: boolean}} [options] - `allowHttp` 为 true 时才接受明文 http。
 * @returns {{ok: true, url: string} | {ok: false, failure: string}} 端点或失败原因。
 */
export function resolveEndpoint(serverAddress, path, options = {}) {
  const raw = String(serverAddress ?? '').trim()
  if (raw === '') return { ok: false, failure: 'address-missing' }

  let base
  try {
    base = new URL(raw)
  } catch {
    return { ok: false, failure: 'address-invalid' }
  }

  if (!ALLOWED_PROTOCOLS.has(base.protocol)) return { ok: false, failure: 'address-scheme' }
  if (base.protocol === 'http:' && options.allowHttp !== true) return { ok: false, failure: 'address-insecure' }
  if (base.hostname === '') return { ok: false, failure: 'address-invalid' }
  // 带上凭据的 URL（`https://user:pass@host`）会被 fetch 当作 Basic 认证送出。
  // 我们的凭据只走请求体，所以出现 userinfo 一律判为填错。
  if (base.username !== '' || base.password !== '') return { ok: false, failure: 'address-userinfo' }

  const suffix = String(path ?? '')
  const url = `${base.origin}${base.pathname.replace(/\/$/u, '')}${suffix.startsWith('/') ? suffix : `/${suffix}`}`
  return { ok: true, url }
}

/**
 * 发一次 JSON 请求。
 *
 * 所有失败都被压成 `{ok:false, failure}`：`failure` 是给 UI 选文案的原因码，
 * **不是**自由文本，也不含服务端原文。
 *
 * @param {object} params - 请求参数。
 * @param {string} params.url - 绝对 URL（应当来自 {@link resolveEndpoint}）。
 * @param {string} params.method - HTTP 方法。
 * @param {object} [params.body] - 请求体（会被 JSON 序列化）。
 * @param {string} [params.token] - 用作 `Authorization: Bearer` 的令牌。
 * @param {number} [params.timeoutMs] - 超时毫秒。
 * @returns {Promise<{ok:true, data:unknown} | {ok:false, failure:string, status?:number, code?:string}>} 结果。
 */
export async function requestJson(params) {
  const { url, method, body, token } = params
  const timeoutMs = Number.isFinite(params.timeoutMs) ? params.timeoutMs : DEFAULT_CONFIG.timeoutMs

  const headers = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (typeof token === 'string' && token !== '') headers.authorization = `Bearer ${token}`

  let response
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // 授权端点是精确地址：任何重定向都当作配置错误直接失败。
      // 这是"不跟随重定向到其它 origin"的最严格版本，也顺带堵掉了
      // "从内网地址跳到任意主机"的路径。
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    // 超时、DNS 失败、连接被拒、TLS 失败、重定向被拒 —— 对外都是"连不上"。
    // 刻意不区分：把 TLS 错误细节回给界面只会变成噪音，且可能泄漏主机信息。
    return { ok: false, failure: TRANSPORT_FAILURE, code: error?.name === 'TimeoutError' ? 'timeout' : undefined }
  }

  const status = response.status
  if (status === 401 || status === 403) {
    // 服务器在这个端点上把授权否定了 —— 凭据失效，不是网络问题。
    return { ok: false, failure: 'rejected', status }
  }

  let data
  try {
    data = await response.json()
  } catch {
    return { ok: false, failure: 'malformed', status }
  }

  if (status >= 500) return { ok: false, failure: 'server-error', status }
  if (!response.ok) {
    // 只取服务端自己的 `code`（且必须是短字符串）—— 不回显 message/stack。
    const code = typeof data?.code === 'string' && data.code.length <= 64 ? data.code : undefined
    return { ok: false, failure: 'rejected', status, code }
  }

  return { ok: true, data }
}

/**
 * 从服务端响应里按字段映射抽出会话数据。
 *
 * 字段名可配（`fields`）是为了不让插件绑死在某一种授权服务器协议上：
 * 协议不匹配时只改配置，不改代码。
 *
 * @param {unknown} data - 服务端响应体。
 * @param {{token:string, refreshToken:string, expiresIn:string, user:string}} fields - 字段映射。
 * @returns {{token: string|null, refreshToken: string|null, expiresAt: number|null, username: string|null}} 会话数据。
 */
export function extractSession(data, fields) {
  const source = data && typeof data === 'object' ? /** @type {Record<string, unknown>} */ (data) : {}

  const token = readString(source, fields.token)
  const refreshToken = readString(source, fields.refreshToken)

  // expiresIn 可能是"多少秒后过期"（数字）或一个 ISO 时间戳（字符串），两者都收。
  const expiresRaw = source[fields.expiresIn]
  let expiresAt = null
  if (typeof expiresRaw === 'number' && Number.isFinite(expiresRaw)) {
    // 约定：小于 1e6 当作秒（约 11.5 天以内），否则当作 epoch 毫秒。
    expiresAt = expiresRaw < 1_000_000 ? Date.now() + expiresRaw * 1000 : expiresRaw
  } else if (typeof expiresRaw === 'string' && expiresRaw !== '') {
    const parsed = Date.parse(expiresRaw)
    expiresAt = Number.isFinite(parsed) ? parsed : null
  }

  const userRaw = source[fields.user]
  const username = typeof userRaw === 'string'
    ? userRaw
    : (userRaw && typeof userRaw === 'object' && typeof userRaw.name === 'string' ? userRaw.name : null)

  return { token, refreshToken, expiresAt, username }
}

/**
 * 用凭据换 token。
 *
 * @param {object} params - 参数。
 * @param {string} params.url - 登录端点。
 * @param {string} params.username - 用户名。
 * @param {string} params.password - 密码（只用于当次交换）。
 * @param {number} [params.timeoutMs] - 超时毫秒。
 * @returns {Promise<object>} {@link requestJson} 的结果。
 */
export function login({ url, username, password, timeoutMs }) {
  return requestJson({ url, method: 'POST', body: { username, password }, timeoutMs })
}

/**
 * 用 refresh token 续期。
 *
 * @param {object} params - 参数。
 * @param {string} params.url - 续期端点。
 * @param {string} params.refreshToken - refresh token。
 * @param {number} [params.timeoutMs] - 超时毫秒。
 * @returns {Promise<object>} {@link requestJson} 的结果。
 */
export function refresh({ url, refreshToken, timeoutMs }) {
  return requestJson({ url, method: 'POST', body: { refreshToken }, timeoutMs })
}

/**
 * 用 access token 校验授权是否仍然有效。
 *
 * **当前没有被启动路径使用** —— 启动校验走的是 `refresh`（续期成功即视为授权有效，
 * 见 lib/index.js 的 `runBootstrap()`）：那样一次请求就同时完成了"触达服务端"与
 * "换取新 access token"，比 verify + refresh 两跳更省。
 *
 * 这个函数保留给运行期复查，以及给消费方做"token 还有效吗"的轻量探测。
 * 服务端仍需按 `paths.verify` 实现它。
 *
 * @param {object} params - 参数。
 * @param {string} params.url - 校验端点。
 * @param {string} params.token - access token。
 * @param {number} [params.timeoutMs] - 超时毫秒。
 * @returns {Promise<object>} {@link requestJson} 的结果。
 */
export function verify({ url, token, timeoutMs }) {
  return requestJson({ url, method: 'GET', token, timeoutMs })
}

/**
 * 通知服务端登出（尽力而为）。
 *
 * 本地记录一定要清，所以这里**永不抛错**：服务器不可达时也要让用户退出去。
 *
 * @param {object} params - 参数。
 * @param {string} params.url - 登出端点。
 * @param {string} params.token - access token。
 * @param {number} [params.timeoutMs] - 超时毫秒。
 * @returns {Promise<void>} 始终 resolve。
 */
export async function logout({ url, token, timeoutMs }) {
  try {
    await requestJson({ url, method: 'POST', token, timeoutMs })
  } catch {
    // 故意吞掉：登出的语义是"本地立刻失效"，服务端那一跳只是礼貌通知。
  }
}

/**
 * 把失败原因码映射到授权状态。
 *
 * 这个映射是"离线阻断策略"的落点：服务器不可达必须是独立的 `unreachable` 状态，
 * 而不是混进 `unauthenticated` —— 两者的用户引导完全不同（见 lib/state.js）。
 *
 * @param {{failure: string}} result - 失败结果。
 * @returns {string} {@link AUTH_STATUS} 里的状态。
 */
export function statusForFailure(result) {
  if (result.failure === 'transport' || result.failure === 'server-error') return AUTH_STATUS.UNREACHABLE
  return AUTH_STATUS.UNAUTHENTICATED
}

/**
 * 读一个必须是字符串的字段。
 *
 * @param {Record<string, unknown>} source - 响应体。
 * @param {string} key - 字段名。
 * @returns {string|null} 值。
 */
function readString(source, key) {
  const value = source[key]
  return typeof value === 'string' && value !== '' ? value : null
}

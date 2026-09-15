/**
 * 本地假授权服务器 —— 只为实测 Auth Gate 而存在，**不是**生产代码。
 *
 * 用途：真实授权服务器还不存在，而闸门是 fail-closed 的（连不上就阻断），
 * 所以没有它就没法在真实应用里走通「登录 → 进系统」这条路径。
 *
 * 它按 `cordis.patch.yml` 里的默认协议实现四个端点：
 *
 *   POST /api/auth/login     {username, password}      → {token, refreshToken, expiresIn, user}
 *   GET  /api/auth/verify    Authorization: Bearer ... → {user}
 *   POST /api/auth/refresh   {refreshToken}            → {token, refreshToken, expiresIn}
 *   POST /api/auth/logout    Authorization: Bearer ... → {}
 *
 * 默认接受固定凭证 `demo` / `demo`（可用环境变量覆盖），access token 15 分钟过期，
 * refresh token 7 天 —— 这样"启动时用 refresh 续期"那条路径也能真的被走到。
 *
 * 用法：
 *   node dsh-auth-gate/scripts/mock-auth-server.mjs [port]
 *   MOCK_AUTH_USER=alice MOCK_AUTH_PASSWORD=s3cret node .../mock-auth-server.mjs 9000
 *
 * 安全边界：默认只监听 127.0.0.1。它把口令当明文比、把 token 存内存，
 * 任何情况下都不要把它放到能被别人访问的网络上。
 */

import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

const PORT = Number(process.argv[2] ?? process.env.MOCK_AUTH_PORT ?? 8787)
const HOST = process.env.MOCK_AUTH_HOST ?? '127.0.0.1'
const EXPECTED_USER = process.env.MOCK_AUTH_USER ?? 'demo'
const EXPECTED_PASSWORD = process.env.MOCK_AUTH_PASSWORD ?? 'demo'

/** access token 存活秒数。故意设短，方便观察续期与过期。 */
const ACCESS_TTL_SECONDS = Number(process.env.MOCK_AUTH_ACCESS_TTL ?? 900)
/** refresh token 存活秒数。 */
const REFRESH_TTL_SECONDS = Number(process.env.MOCK_AUTH_REFRESH_TTL ?? 7 * 24 * 3600)

/** access token → 会话。 */
const accessTokens = new Map()
/** refresh token → 会话。 */
const refreshTokens = new Map()

const now = () => Date.now()
const log = (...parts) => process.stdout.write(`${new Date().toISOString()} ${parts.join(' ')}\n`)

/** 发一个 JSON 响应。 */
function sendJson(response, status, payload) {
  const body = JSON.stringify(payload ?? {})
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    // 明确不要被任何中间层缓存凭据响应。
    'cache-control': 'no-store',
  })
  response.end(body)
}

/** 读完请求体并解析 JSON（失败给空对象）。 */
async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    // 假服务器也要有上限，免得一个畸形请求把内存吃掉。
    if (size > 64 * 1024) return {}
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

/** 从 Authorization 头里取 Bearer token。 */
function bearerToken(request) {
  const raw = request.headers.authorization
  if (typeof raw !== 'string') return undefined
  const match = /^Bearer\s+(.+)$/u.exec(raw.trim())
  return match?.[1]
}

/** 签发一对新 token，并在服务端登记。 */
function issueSession(username) {
  const accessToken = `at_${randomUUID()}`
  const refreshToken = `rt_${randomUUID()}`
  accessTokens.set(accessToken, { username, expiresAt: now() + ACCESS_TTL_SECONDS * 1000 })
  refreshTokens.set(refreshToken, { username, expiresAt: now() + REFRESH_TTL_SECONDS * 1000 })
  return { accessToken, refreshToken }
}

/** 丢掉一个 access token（登出/滚动时用）。 */
function revokeAccess(accessToken) {
  if (accessToken !== undefined) accessTokens.delete(accessToken)
}

/** 清掉已过期的记录，免得长跑时无限增长。 */
function sweepExpired() {
  const current = now()
  for (const [token, session] of accessTokens) if (session.expiresAt <= current) accessTokens.delete(token)
  for (const [token, session] of refreshTokens) if (session.expiresAt <= current) refreshTokens.delete(token)
}

const server = createServer(async (request, response) => {
  sweepExpired()

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const path = url.pathname
  const method = request.method ?? 'GET'
  log(`${method} ${path}`)

  // ── POST /api/auth/login ────────────────────────────────────────────────
  if (path === '/api/auth/login' && method === 'POST') {
    const body = await readJsonBody(request)
    const username = typeof body.username === 'string' ? body.username : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (username !== EXPECTED_USER || password !== EXPECTED_PASSWORD) {
      log('  → 401 凭据不符')
      // 只回一个稳定 code，不回显任何输入 —— 与插件"错误信息不外泄"的取向一致。
      sendJson(response, 401, { code: 'invalid-credentials' })
      return
    }
    const { accessToken, refreshToken } = issueSession(username)
    log(`  → 200 登录成功 user=${username}`)
    sendJson(response, 200, {
      token: accessToken,
      refreshToken,
      expiresIn: ACCESS_TTL_SECONDS,
      user: { name: username },
    })
    return
  }

  // ── GET /api/auth/verify ────────────────────────────────────────────────
  if (path === '/api/auth/verify' && (method === 'GET' || method === 'POST')) {
    const token = bearerToken(request)
    const session = token === undefined ? undefined : accessTokens.get(token)
    if (session === undefined || session.expiresAt <= now()) {
      log('  → 401 access token 无效或已过期')
      sendJson(response, 401, { code: 'token-invalid' })
      return
    }
    log(`  → 200 校验通过 user=${session.username}`)
    sendJson(response, 200, { user: { name: session.username } })
    return
  }

  // ── POST /api/auth/refresh ──────────────────────────────────────────────
  if (path === '/api/auth/refresh' && method === 'POST') {
    const body = await readJsonBody(request)
    const presented = typeof body.refreshToken === 'string' ? body.refreshToken : ''
    const session = refreshTokens.get(presented)
    if (session === undefined || session.expiresAt <= now()) {
      log('  → 401 refresh token 无效或已过期')
      sendJson(response, 401, { code: 'refresh-invalid' })
      return
    }
    // 滚动刷新：旧的 refresh token 立刻作废，避免被重放。
    refreshTokens.delete(presented)
    const { accessToken, refreshToken } = issueSession(session.username)
    log(`  → 200 续期成功 user=${session.username}`)
    sendJson(response, 200, {
      token: accessToken,
      refreshToken,
      expiresIn: ACCESS_TTL_SECONDS,
      user: { name: session.username },
    })
    return
  }

  // ── POST /api/auth/logout ───────────────────────────────────────────────
  if (path === '/api/auth/logout' && method === 'POST') {
    revokeAccess(bearerToken(request))
    // 登出只按 access token 定位，所以这里顺手清掉该用户的所有 refresh token 是不做的 ——
    // 假服务器保持简单，真实实现应当按会话族失效。
    log('  → 200 已登出')
    sendJson(response, 200, {})
    return
  }

  log('  → 404')
  sendJson(response, 404, { code: 'not-found' })
})

server.listen(PORT, HOST, () => {
  log(`假授权服务器已启动：http://${HOST}:${PORT}`)
  log(`  凭证：${EXPECTED_USER} / ${EXPECTED_PASSWORD}`)
  log(`  access token ${ACCESS_TTL_SECONDS}s，refresh token ${REFRESH_TTL_SECONDS}s`)
  log('  Ctrl+C 停止。仅监听回环地址，不要暴露到网络上。')
})

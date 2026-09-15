/**
 * 凭据记录的读写 —— token 落盘方案 C。
 *
 * **C 方案是什么，以及为什么选它**（2026-09-15 拍板）：
 * 落盘的只有 **refresh token**，access token 只活在内存（见 lib/state.js）。
 * 理由是实测出来的两条事实（`.workbuddy/auth-gate-plugin-assessment.md` §4.2 / §6.2）：
 *
 * 1. 记录落盘是 `$DSH_HOME/.credentials.yaml`，**纯文本 YAML**，`writeFileAtomic`
 *    未传 mode（实测 `mode 666`），全程没有 `crypto`/`safeStorage` 调用。
 * 2. 记录空间**没有身份隔离**：`readRecord` 不接受任何调用方身份参数，
 *    `listRecords()` 列出全部 —— 任何一个已安装的插件都能读到这条记录。
 *
 * 所以 scope（`auth-gate`）只是**命名**，不是访问边界。能真正依赖的防护是
 * **短有效期 + refresh 轮换**（以及后续排期的桌面侧 `safeStorage` 提供方）。
 * 把 access token 的暴露窗口压到进程生命周期内，是当前架构下能拿到的最好结果。
 *
 * **这个模块绝不写入的东西**：密码、access token。前者只用于当次交换，
 * 后者只在内存。改这个文件时请守住这条线。
 *
 * 写入一律走 `ctx.credentials.modifyRecord`：它是唯一的写路径，且是"序列化
 * 读-改-写 + 跨进程锁"——官方明确说这是为 token 轮换设计的（两个进程并发轮换
 * refresh token 不会互相覆盖）。**不要自己写文件。**
 */

import { CREDENTIAL_KEY } from './constants.js'

/** 载荷版本。将来改结构时用它做迁移判断。 */
export const SESSION_PAYLOAD_VERSION = 1

/**
 * 校验一个段名是否符合 `credentialKey` 的语法。
 *
 * 与上游一致：`/^[a-z][a-z0-9-]*$/`（`dsh-credentials/lib/index.js`）。
 * 我们不用 `credentialKey()` 而是自己判，是为了让这个包保持零导入 ——
 * 品牌只存在于类型层，运行时键就是一个普通字符串。
 *
 * @param {string} value - 待校验段。
 * @returns {boolean} 是否合法。
 */
export function isCredentialKeySegment(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9-]*$/u.test(value)
}

// 键常量在模块加载时校验一次：段名写错时 fail loud 在我们自己的错误信息上，
// 而不是等到第一次写入时拿到上游抛出的 TypeError。
{
  const [scope, id] = CREDENTIAL_KEY.split('/')
  if (!isCredentialKeySegment(scope) || !isCredentialKeySegment(id)) {
    throw new Error(
      `auth-gate: CREDENTIAL_KEY "${CREDENTIAL_KEY}" must be "<scope>/<id>" of lowercase hyphenated identifiers`,
    )
  }
}

/**
 * 把任意来源的载荷归一化成合法的会话记录。
 *
 * 防御性解析是必须的：`.credentials.yaml` 是明文文件，用户可以手改，
 * 也可能被更早的版本写坏。任何形状异常都应当读成"没有有效记录"，
 * 而不是让插件在启动路径上抛错。
 *
 * @param {unknown} payload - 记录里的 `payload`。
 * @returns {object|null} 归一化载荷；不可用时为 null。
 */
export function normalizeSessionPayload(payload) {
  if (!payload || typeof payload !== 'object') return null
  const source = /** @type {Record<string, unknown>} */ (payload)

  const serverAddress = typeof source.serverAddress === 'string' ? source.serverAddress.trim() : ''
  const username = typeof source.username === 'string' ? source.username : ''
  if (serverAddress === '' || username === '') return null

  const refreshToken = typeof source.refreshToken === 'string' && source.refreshToken !== ''
    ? source.refreshToken
    : null

  return {
    version: SESSION_PAYLOAD_VERSION,
    serverAddress,
    username,
    /** 唯一落盘的秘密。见文件头。 */
    refreshToken,
    refreshExpiresAt: toEpoch(source.refreshExpiresAt),
    /** access token 的过期时间 —— 是元数据不是秘密，落盘可以省一次探测。 */
    expiresAt: toEpoch(source.expiresAt),
    issuedAt: toEpoch(source.issuedAt) ?? Date.now(),
  }
}

/**
 * 读会话记录。
 *
 * @param {object} credentials - `ctx.credentials`。
 * @returns {Promise<object|null>} 归一化载荷；无记录或不可用时为 null。
 * @throws 存储层错误（IO / 锁超时）原样抛出，由调用方决定降级策略 ——
 *         "读不到就当作未登录"是调用方的决定，不该在这里偷偷吞掉。
 */
export async function readSession(credentials) {
  const record = await credentials.readRecord(CREDENTIAL_KEY)
  if (!record || record.kind !== 'grant') return null
  return normalizeSessionPayload(record.payload)
}

/**
 * 写入会话记录。
 *
 * 只接受 refresh token：传进来的对象里若带 `token` / `accessToken` / `password`，
 * 会被显式丢弃 —— 让"手滑把 access token 传进来"这件事在代码层面不成立。
 *
 * @param {object} credentials - `ctx.credentials`。
 * @param {{serverAddress: string, username: string, refreshToken?: string|null,
 *          refreshExpiresAt?: number|null, expiresAt?: number|null, issuedAt?: number}} session - 会话数据。
 * @returns {Promise<void>} 写入完成。
 */
export async function writeSession(credentials, session) {
  const payload = {
    version: SESSION_PAYLOAD_VERSION,
    serverAddress: String(session.serverAddress ?? '').trim(),
    username: String(session.username ?? ''),
    refreshToken: session.refreshToken ?? null,
    refreshExpiresAt: session.refreshExpiresAt ?? null,
    expiresAt: session.expiresAt ?? null,
    issuedAt: session.issuedAt ?? Date.now(),
  }
  await credentials.modifyRecord(CREDENTIAL_KEY, () => ({ kind: 'grant', payload }))
}

/**
 * 清除会话记录。
 *
 * @param {object} credentials - `ctx.credentials`。
 * @returns {Promise<void>} 清除完成。
 */
export async function clearSession(credentials) {
  await credentials.deleteRecord(CREDENTIAL_KEY)
}

/**
 * 探测记录是否存在，**不读取值**。
 *
 * 配置界面与诊断应当用这个而不是 `readSession()`：实测 `describeRecord` 的返回
 * 只有 `configured / kind / writable` 三个键，不含任何值字段。
 *
 * @param {object} credentials - `ctx.credentials`。
 * @returns {Promise<{configured: boolean, kind?: string, writable?: boolean}>} 描述。
 */
export async function describeSession(credentials) {
  return credentials.describeRecord(CREDENTIAL_KEY)
}

/**
 * 把各种时间表示收敛成 epoch 毫秒。
 *
 * @param {unknown} value - 数字（epoch ms）、ISO 字符串、或 undefined。
 * @returns {number|null} epoch 毫秒；无法解析时为 null。
 */
function toEpoch(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value !== '') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/**
 * Auth Gate 的状态机 —— 内存态，单一真相。
 *
 * 两件事刻意分开存放：
 *
 * - **可公开快照**（`get()`）：状态、用户名、服务器地址、有效期。它会经 HTTP
 *   `/api/auth-gate/state` 回给渲染器，所以**任何响应里都不出现 token** ——
 *   这条立场照抄上游 `CredentialsController`（`no method here returns one`）。
 * - **秘密**（`setAccessToken()`）：access token 只活在内存里，不进快照、不落盘、
 *   不进日志。落盘的只有 refresh token（见 lib/session.js 的 C 方案）。
 *
 * 状态流转：
 *
 *   checking ──► authenticated        本地记录有效 且 服务端 verify 通过
 *       │
 *       ├──────► unauthenticated      无记录 / 服务端否定 / 用户登出
 *       │
 *       └──────► unreachable          服务器超时或连不上（离线阻断策略）
 *
 * `unreachable` 与 `unauthenticated` 对闸门含义相同（都拒绝），但**必须分开**：
 * 前者该引导"检查网络 / 联系管理员"，后者该引导"重新登录"。混在一起会让用户
 * 反复重试错误的动作。
 */

import { AUTH_STATUS } from './constants.js'

/** 状态原因码。给 UI 选文案用，不进自由文本（便于 i18n 与自动化断言）。 */
export const REASON = Object.freeze({
  /** 还没有本地记录。 */
  NO_RECORD: 'no-record',
  /** 本地记录已过期且无法续期。 */
  EXPIRED: 'expired',
  /** 服务端明确否定（401/403）。 */
  REJECTED: 'rejected',
  /** 服务器不可达（超时 / 连接失败 / 5xx）。 */
  UNREACHABLE: 'unreachable',
  /** 用户主动登出。 */
  LOGOUT: 'logout',
  /** 插件内部错误（配置非法、协议不匹配…）。 */
  ERROR: 'error',
})

/**
 * 建一个授权状态机。
 *
 * @param {object} [initial] - 初始快照分片。
 * @returns {object} 状态机。
 */
export function createAuthStore(initial = {}) {
  let snapshot = Object.freeze({
    status: AUTH_STATUS.CHECKING,
    reason: null,
    username: null,
    serverAddress: null,
    expiresAt: null,
    checkedAt: null,
    ...initial,
  })

  /** access token：只在这里。刻意不进 snapshot。 */
  let accessToken = null

  const listeners = new Set()

  const emit = () => {
    for (const listener of listeners) {
      try {
        listener(snapshot)
      } catch {
        // 订阅方（HTTP 推送、日志）抛错不能把状态机带下去。
      }
    }
  }

  return {
    /** @returns {object} 当前可公开快照（冻结）。 */
    get: () => snapshot,

    /**
     * 合并一个分片并广播。
     * @param {object} patch - 要合并的字段。
     * @returns {object} 新快照。
     */
    patch(patch) {
      snapshot = Object.freeze({ ...snapshot, ...patch })
      emit()
      return snapshot
    },

    /**
     * 订阅状态变化。
     * @param {(snapshot: object) => void} listener - 变化回调。
     * @returns {() => void} 退订。
     */
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    /** @returns {boolean} 当前是否已授权。`checking`/`unreachable` 一律为 false。 */
    isAuthorized: () => snapshot.status === AUTH_STATUS.AUTHENTICATED,

    /**
     * 存放 access token（仅内存）。
     * @param {string|null} token - 令牌；null 表示清除。
     */
    setAccessToken(token) {
      accessToken = typeof token === 'string' && token !== '' ? token : null
    },

    /**
     * 读 access token。
     *
     * 消费方契约束（照抄上游对凭据的要求：每次操作重新读、不得跨操作缓存）：
     * 需要 token 的 MCP 编排与回环代理应当**每次请求**调它，这样轮换即时生效。
     * @returns {string|null} 令牌。
     */
    getAccessToken: () => accessToken,

    /** @returns {boolean} 内存里是否握着 access token。 */
    hasAccessToken: () => accessToken !== null,
  }
}

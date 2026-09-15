/**
 * Client 侧的状态代理。
 *
 * 渲染器与 Host 之间走**同源 HTTP**（主窗口的 origin 就是
 * `http://127.0.0.1:<webServer.port>`，所以同源 fetch 可用，桌面自己的设置页
 * 也是这么干的）。没有用 Typert Remote —— 那条路需要把编译期描述符生成接进
 * 本包的构建，而这个包刻意零构建。
 *
 * `getSnapshot()` 返回**稳定引用**（只在变化时换新对象），这样它可以安全地喂给
 * React 的 `useSyncExternalStore`；每次调用都新建对象的写法会让 React 无限重渲染。
 */

import { API_PREFIX, AUTH_STATUS } from '../../lib/constants.js'

/** 状态轮询间隔。登录成功/失败会立刻触发一次刷新，所以这只是在兜底。 */
const DEFAULT_INTERVAL_MS = 1500

/**
 * 建一个闸门控制器。
 *
 * @param {object} [options] - 选项。
 * @param {string} [options.serverAddress] - 配置里的默认服务器地址。
 * @param {number} [options.intervalMs] - 轮询间隔。
 * @returns {object} 控制器。
 */
export function createGateController(options = {}) {
  const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : DEFAULT_INTERVAL_MS
  const defaultServerAddress = typeof options.serverAddress === 'string' ? options.serverAddress : ''

  let view = Object.freeze({
    snapshot: Object.freeze({
      status: AUTH_STATUS.CHECKING,
      reason: null,
      username: null,
      serverAddress: defaultServerAddress,
      expiresAt: null,
    }),
    /** 最近一次登录动作的失败原因码；与 Host 的状态原因分开存。 */
    failure: null,
  })

  const listeners = new Set()
  let timer = null

  const publish = (patch) => {
    view = Object.freeze({ ...view, ...patch })
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // 订阅方抛错不能把轮询带下去。
      }
    }
  }

  /** 拉一次状态。Host 还没起来时静默跳过，下一轮再试。 */
  const poll = async () => {
    try {
      const response = await fetch(`${API_PREFIX}/state`, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      if (!response.ok) return
      const data = await response.json()
      if (data && typeof data.state === 'object' && data.state !== null) {
        publish({ snapshot: Object.freeze(data.state) })
      }
    } catch {
      // 传输失败（Host 重启中 / 端口未就绪）：保持当前状态，不把状态改成"未授权"，
      // 否则界面会在 Host 抖动时闪一下登录页。
    }
  }

  /**
   * 发一个 POST 动作并吸收结果。
   *
   * @param {string} path - 相对路径（接在 {@link API_PREFIX} 后）。
   * @param {object} [body] - 请求体。
   * @returns {Promise<{ok: boolean, failure?: string}>} 结果。
   */
  const post = async (path, body) => {
    let response
    try {
      response = await fetch(`${API_PREFIX}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      })
    } catch {
      publish({ failure: 'transport' })
      return { ok: false, failure: 'transport' }
    }

    let data = null
    try {
      data = await response.json()
    } catch {
      // 保持 data 为 null，下面按 !response.ok 处理。
    }

    if (data && typeof data.state === 'object' && data.state !== null) {
      publish({ snapshot: Object.freeze(data.state) })
    }

    if (response.ok && data?.ok === true) {
      publish({ failure: null })
      return { ok: true }
    }
    const failure = typeof data?.failure === 'string' ? data.failure : 'internal'
    publish({ failure })
    return { ok: false, failure }
  }

  return {
    /** @returns {object} 稳定引用的视图对象。 */
    getSnapshot: () => view,

    /**
     * 订阅变化。
     * @param {() => void} listener - 变化回调。
     * @returns {() => void} 退订。
     */
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    /** 开始轮询（幂等）。 */
    start() {
      if (timer !== null) return
      void poll()
      timer = setInterval(() => { void poll() }, intervalMs)
    },

    /** 停止轮询。 */
    stop() {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    },

    /** @returns {boolean} 当前是否已授权。 */
    isAuthorized: () => view.snapshot.status === AUTH_STATUS.AUTHENTICATED,

    /**
     * 提交登录。
     * @param {{serverAddress?: string, username: string, password: string}} payload - 表单。
     * @returns {Promise<{ok: boolean, failure?: string}>} 结果。
     */
    login: (payload) => post('/login', payload),

    /**
     * 退出登录。
     * @returns {Promise<{ok: boolean, failure?: string}>} 结果。
     */
    logout: () => post('/logout'),

    /**
     * 让 Host 重新做一次启动校验（服务器不可达时的"重新检查"）。
     * @returns {Promise<{ok: boolean, failure?: string}>} 结果。
     */
    recheck: () => post('/refresh-check'),

    /** @returns {string} 配置里的默认服务器地址。 */
    getDefaultServerAddress: () => defaultServerAddress,
  }
}

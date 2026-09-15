/**
 * Auth Gate 的共享常量与配置归一化。
 *
 * 这个文件是零依赖的：不 import 任何 `@deepseek-ai/*`，也不 import `react`。
 * 原因是包本身零运行时依赖（见 README「为什么零依赖」），Host 与 Client
 * 两半边都从这里取枚举与默认值，避免两边对不齐。
 */

/** 凭据记录的 scope 段。`credentialKey()` 要求 `^[a-z][a-z0-9-]*$`。 */
export const SCOPE = 'auth-gate'

/** 凭据记录的 id 段。整个键就是 `auth-gate/session`。 */
export const SESSION_ID = 'session'

/**
 * 凭据记录的键。
 *
 * 上游 `credentialKey(scope, id)` 的实现是 `brandString(`${scope}/${id}`)` 外加一次
 * 段名校验（`dsh-credentials/lib/index.js`，正则 `/^[a-z][a-z0-9-]*$/`）。品牌只存在于
 * 类型层，运行时就是一个普通字符串 —— 所以这里直接给出等价字面量，让插件保持零导入。
 * 校验规则与上游一致，改键名时两段都必须仍然匹配该正则。
 */
export const CREDENTIAL_KEY = `${SCOPE}/${SESSION_ID}`

/**
 * 授权状态。**fail-closed 是设计前提**：初始态是 `checking` 而不是某种"乐观放行"，
 * 且闸门把 `checking` 与 `unreachable` 一并视为未授权。
 */
export const AUTH_STATUS = Object.freeze({
  /** 尚未得出结论（启动后的第一瞬间）。闸门在此态下拒绝。 */
  CHECKING: 'checking',
  /** 已确认未授权：无记录、凭据被服务端否定、或用户已登出。 */
  UNAUTHENTICATED: 'unauthenticated',
  /** 已授权：本地记录有效且服务端校验通过。 */
  AUTHENTICATED: 'authenticated',
  /**
   * 服务器不可达（超时 / 连接失败 / 5xx）。
   *
   * 与 `UNAUTHENTICATED` 分开是刻意的：用户的下一步动作完全不同 ——
   * 前者是"检查网络或联系管理员"，后者是"重新登录"。
   * 两者对闸门的含义相同：都拒绝。
   */
  UNREACHABLE: 'unreachable',
})

/** 闸门形态。见 lib/gate-mode.js。 */
export const GATE_MODE = Object.freeze({
  /** 登录页覆盖在 AppFrame 之上（上游推荐的 `shell.overlay`）。 */
  OVERLAY: 'overlay',
  /** 用 `priority:-1` 遮蔽 `root`，AppFrame 组件根本不挂载。 */
  ROOT_SHADOW: 'root-shadow',
})

/** 未授权时模型调用被短路后回给用户的那句话（Host 侧，不进 locale 字典）。 */
export const DEFAULT_DENY_MESSAGE = '当前会话未通过授权校验，请先完成登录。'

/** 工具调用被守卫拒绝时的原因串。前缀是给自动化消费方识别的稳定码。 */
export const TOOL_DENY_REASON = 'UNAUTHENTICATED: 授权未完成，工具调用已拒绝。'

/** 配置默认值。`cordis.patch.yml` 里写的是同一份，这里是代码侧兜底。 */
export const DEFAULT_CONFIG = Object.freeze({
  gateMode: GATE_MODE.OVERLAY,
  serverAddress: '',
  allowHttp: false,
  timeoutMs: 5000,
  paths: Object.freeze({
    verify: '/api/auth/verify',
    login: '/api/auth/login',
    refresh: '/api/auth/refresh',
    logout: '/api/auth/logout',
  }),
  fields: Object.freeze({
    token: 'token',
    refreshToken: 'refreshToken',
    expiresIn: 'expiresIn',
    user: 'user',
  }),
})

/** Host 与 Client 之间的同源 HTTP 前缀（客户端 fetch 用同一个常量）。 */
export const API_PREFIX = '/api/auth-gate'

/**
 * 把 Loader 传来的原始 config 归一化成完整配置。
 *
 * 手写而不是用 schemastery：这个包零依赖，而 schemastery 是一个运行时依赖。
 * 归一化的目标是"任何垃圾输入都得到一个可用的配置"，而不是拒绝启动 ——
 * 一个配错字段的门禁插件不应该把整个应用带下去。
 *
 * @param {unknown} raw - Loader 行上的 `config`。
 * @returns {typeof DEFAULT_CONFIG} 完整配置。
 */
export function normalizeConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const timeout = Number(source.timeoutMs)
  return {
    gateMode: source.gateMode === GATE_MODE.ROOT_SHADOW ? GATE_MODE.ROOT_SHADOW : GATE_MODE.OVERLAY,
    serverAddress: typeof source.serverAddress === 'string' ? source.serverAddress.trim() : '',
    allowHttp: source.allowHttp === true,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_CONFIG.timeoutMs,
    paths: { ...DEFAULT_CONFIG.paths, ...(source.paths ?? {}) },
    fields: { ...DEFAULT_CONFIG.fields, ...(source.fields ?? {}) },
  }
}

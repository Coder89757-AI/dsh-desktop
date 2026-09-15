/**
 * 闸门形态开关。
 *
 * 两种形态用的是**同一个**登录页组件，差别只在注册到哪个槽位、以及要不要给
 * `priority`。所以这里的全部职责就是把这个差别翻译成 `ctx.slots.register` 的
 * 参数 —— 一份真相，Host 与 Client 都不再各自判断。
 *
 * 形态对照（决策于 2026-09-15，见 .workbuddy/auth-gate-plugin-assessment.md §6.3）：
 *
 * | | overlay | root-shadow |
 * |---|---|---|
 * | 注册目标 | `shell.overlay`（list/root，上游推荐） | `root`（single/root） |
 * | 视觉 | 登录页覆盖在 AppFrame 之上 | 整页只有登录页 |
 * | 强度 | 中 —— AppFrame 仍在后台挂载，全局快捷键等旁路需实测 | 强 —— AppFrame 组件不挂载 |
 * | 副作用面 | 小 | 有（见下方两条硬约束） |
 *
 * `root-shadow` 的两条硬约束都是"踩了就直接抛错"或"静默丢服务"，不能靠试错：
 *
 * 1. **绝不传 `children`**。`ui-layout` 已经声明了 `sidebar`/`main`/`rightbar`/
 *    `shell.overlay` 四个子槽位，而 `SlotCore.register` 对"已声明的子槽位"直接
 *    `throw`（`dsh-client-ui-slots/lib/index.js`）。桌面的 `advanced-shell.ts` 能传
 *    children 是因为它**先禁用了 `ui-layout` 行**，第三方插件付不起这个代价。
 * 2. **不禁用 `ui-layout` 行**。它的 `apply()` 里除了注册 root，还 `provide('layout')`、
 *    `provideRoot({hooks:{panelInfo}})`、`subscribe('main', retainMainPanels)`。
 *    禁用它 = 丢掉 `ctx.layout` 服务。遮蔽只能遮蔽**渲染**，不能遮蔽**服务** ——
 *    所以用 `priority:-1` 让 AppFrame 不渲染，那行本身照常运行。
 *
 * 另外：`root` 上官方 AppFrame 的注册没给 priority（=0），而同一 cell 同 priority
 * 的第二次注册会抛错，所以遮蔽**必须**显式给负数。
 */

import { GATE_MODE } from './constants.js'

/** `overlay` 形态在 `shell.overlay` 里的条目 id。与包名一致便于辨认。 */
export const OVERLAY_ENTRY_ID = 'auth-gate'

/**
 * `overlay` 形态的显示顺序。
 *
 * 取一个很负的值：闸门必须是覆盖层里最先渲染的那个，否则市场上别的 overlay
 * （比如社区市场的浮层）会画在登录页之上，把凭据输入框遮住。
 */
export const OVERLAY_ORDER = -1000

/** `root` 遮蔽用的优先级。必须 < 0 —— 官方 AppFrame 在 0。 */
export const ROOT_SHADOW_PRIORITY = -1

/**
 * 把形态名解析成 `ctx.slots.register` 的选项。
 *
 * 注意返回值**故意不含 `priority` 以外的任何可选字段**：调用方把它展开进
 * register 的 options 即可，不要自己再补 `children`（见文件头约束 1）。
 *
 * @param {string} mode - `GATE_MODE.OVERLAY` 或 `GATE_MODE.ROOT_SHADOW`。
 * @returns {{name: string, id?: string, order?: number, priority?: number}} 注册选项。
 */
export function resolveGateTarget(mode) {
  if (mode === GATE_MODE.ROOT_SHADOW) {
    return { name: 'root', priority: ROOT_SHADOW_PRIORITY }
  }
  return { name: 'shell.overlay', id: OVERLAY_ENTRY_ID, order: OVERLAY_ORDER }
}

/*
 * 注册时两种形态**统一**用 `ctx.slots.inject(name, () => register(...))` 包一层，
 * 不写"overlay 才需要等、root 不用等"的分支。理由：
 *
 * - `shell.overlay` 由 `ui-layout` 的 AppFrame 注册时才声明，插件加载顺序不保证，
 *   直接 register 会撞上"注册到未声明的槽位"而抛错。
 * - `root` 是 `SlotCore` 构造时预置的 a-priori 声明，`inject` 会立即回调，没有代价。
 * - `inject` 返回的是与调用方 fiber 绑定的幂等 disposer，插件卸载时会自动收掉
 *   等待和已生效的注册 —— 这正是闸门"登录后注销、登出后再注册"需要的语义。
 *
 * 一处真相，少一个可以在两个形态间写歪的分支。
 */

/**
 * 形态的人话描述，给设置页与日志用。避免同一个判断在两个地方写出不同文案。
 *
 * @param {string} mode - 闸门形态。
 * @returns {{key: string, strength: string, note: string}} 描述。
 */
export function describeGateMode(mode) {
  if (mode === GATE_MODE.ROOT_SHADOW) {
    return {
      key: GATE_MODE.ROOT_SHADOW,
      strength: '强',
      note: '应用框架不挂载，整页只有登录页；副作用面需要实测。',
    }
  }
  return {
    key: GATE_MODE.OVERLAY,
    strength: '中',
    note: '登录页覆盖在应用框架之上；框架仍在后台挂载，理论上可被全局快捷键旁路。',
  }
}

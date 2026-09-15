/**
 * Auth Gate — Client 半边。
 *
 * 闸门是**状态驱动**的，不是"加载时挂上就一直在"：
 *
 *   checking / unauthenticated / unreachable  → 注册闸门页（覆盖或遮蔽，见 gateMode）
 *   authenticated                             → 注销闸门页，应用界面出现
 *
 * 注册与注销都收在 `ctx.slots.inject` 返回的那个 disposer 上，所以插件卸载、
 * 槽位被销毁时不会留下悬挂的登录页。
 *
 * ## 闸门形态开关（gateMode）
 *
 * 两种形态用的是同一个组件，差别只在 `resolveGateTarget()` 给出的注册参数：
 *
 *   overlay     → `{ name: 'shell.overlay', id: 'auth-gate', order: -1000 }`
 *   root-shadow → `{ name: 'root', priority: -1 }`
 *
 * 切换形态不改这个文件 —— 改配置即可。两条与 root-shadow 有关的硬约束写在了
 * `resolveGateTarget()` 的文件头注释里（不传 children、不禁用 ui-layout 行），
 * 改这里之前请先读那段。
 */

import { normalizeConfig } from '../../lib/constants.js'
import { resolveGateTarget } from '../../lib/gate-mode.js'
import { createGateController } from './gate-controller.js'
import { AuthGateView } from './gate-view.js'
import { NS, en, zh } from './locales.js'
import { installGateStyles } from './styles.js'
import { UserBadgeView } from './user-badge.js'

export const name = 'dsh-auth-gate'

export const inject = ['slots', 'locale']

/**
 * Client 插件入口。
 *
 * @param {object} ctx - Client Context（已满足 {@link inject}）。
 * @param {object} [rawConfig] - Loader 行上的 `config`（与 Host 同源）。
 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const gate = createGateController({ serverAddress: config.serverAddress })
  const target = resolveGateTarget(config.gateMode)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'auth-gate: dictionaries')
  ctx.effect(() => installGateStyles(), 'auth-gate: styles')

  // 侧边栏用户栏（[用户名] 退出）。常驻注册：组件自己按授权状态决定渲染与否，
  // 与闸门页"只注册一次"的哲学一致。sidebar 没起来（如某些 web 组合）时
  // slots.inject 永远不回调，自然消失，不需要任何分支。
  // 注意：布局调整（排到设置齿轮下方）由组件的 ref 在自己的 DOM 节点上做
  // inline style，**不注入任何全局 CSS**（2026-09-15 全局选择器打过设置页）。
  ctx.effect(
    () => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'auth-gate-user',
      order: 20,
      locale: NS,
      inject: () => ({ gate }),
    }, UserBadgeView)),
    'auth-gate: sidebar user badge',
  )

  // 状态轮询独立于闸门注册：即使闸门被注销（已登录），也还要能察觉到
  // 运行期的登出 / 凭据失效，从而把闸门重新挂回去。
  ctx.effect(() => {
    gate.start()
    return () => gate.stop()
  }, 'auth-gate: state polling')

  ctx.effect(() => {
    let disposeGate = null

    const sync = () => {
      const wanted = !gate.isAuthorized()
      if (wanted && disposeGate === null) {
        // 统一走 slots.inject：它在槽位被声明后回调，返回与本次调用的 fiber 绑定的
        // 幂等 disposer。对 root 是立即回调（预置声明），对 shell.overlay 是等
        // AppFrame 声明后回调 —— 两种形态共用这一行。
        disposeGate = ctx.slots.inject(target.name, () => ctx.slots.register({
          ...target,
          locale: NS,
          inject: () => ({ gate }),
        }, AuthGateView))
        return
      }
      if (!wanted && disposeGate !== null) {
        const drop = disposeGate
        disposeGate = null
        drop()
      }
    }

    const unsubscribe = gate.subscribe(sync)
    sync()

    return () => {
      unsubscribe()
      if (disposeGate !== null) {
        disposeGate()
        disposeGate = null
      }
    }
  }, 'auth-gate: login gate')
}

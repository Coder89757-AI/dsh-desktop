/**
 * 侧边栏用户栏（`sidebar.footer.action`）。
 *
 * 为什么放这个插件而不是单开一个：它需要的**会话状态真相源**（轮询、用户名、
 * 登出动作）全在闸门控制器里；拆出去的插件只能靠读凭据记录/HTTP 反推同一份
 * 状态，等于管两遍还多一条插件间耦合。将来要长成完整"账户页"再拆不迟。
 *
 * 渲染约定：
 * - 注册进官方 sidebar 声明的 **list** 槽位 `sidebar.footer.action`，渲染位置在
 *   设置齿轮**上方**（脚部就两块：footer.action 在上、settings 在下 —— 官方没有
 *   "齿轮下方"的槽位，这是最接近"设置旁边"的标准扩展点）。
 * - **常驻注册、状态驱动渲染**：未授权时组件返回 null，而不是注册/注销槽位 ——
 *   与闸门页"只注册一次"的哲学一致，杜绝"注销失败留下半死 UI"。
 * - `wide` 由 sidebar 传入（展开/收起态）：收起的窄栏只留头像，名字与退出按钮
 *   不渲染（空间不够，也避免误触）。
 * - **绝不触碰宿主容器**（2026-09-15 第三次事故后的铁律）：无论全局 CSS 还是
 *   inline style，一律不对 `footerActions` / `settingsArea` 等宿主元素做任何
 *   改动（display:contents 的两个版本——全局选择器版、closest+inline 版——
 *   都与设置页/设置菜单异常相关）。插件只渲染自己的子树。
 *
 * 用 `createElement` 而不是 JSX：零构建、零依赖，与 gate-view 同一理由。
 */

import { createElement as h, useCallback, useState, useSyncExternalStore } from 'react'
import { AUTH_STATUS } from '../../lib/constants.js'

/**
 * 用户栏组件。
 *
 * @param {object} props - 组合 props。
 * @param {object} props.gate - 闸门控制器（由注册处的 `inject` 注入）。
 * @param {(key: string) => string} [props.t] - locale 命名空间绑定的翻译函数。
 * @param {boolean} [props.wide] - sidebar 展开态（由 sidebar 的 renderSlot 传入）。
 * @returns {object|null} React 节点；未授权时返回 null。
 */
export function UserBadgeView(props) {
  const gate = props.gate
  const tr = typeof props.t === 'function' ? props.t : (key) => key
  const wide = props.wide === true

  const view = useSyncExternalStore(gate.subscribe, gate.getSnapshot, gate.getSnapshot)
  const [busy, setBusy] = useState(false)

  // Hooks 全部在条件返回之前：未授权只是"不渲染"，不能改变 hook 调用序列。
  const exit = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await gate.logout()
    } finally {
      setBusy(false)
    }
  }, [busy, gate])

  if (view.snapshot.status !== AUTH_STATUS.AUTHENTICATED) return null

  const username = view.snapshot.username
  const shown = typeof username === 'string' && username !== '' ? username : '·'

  return h('div', { className: 'dsAuthUserBadge', 'data-wide': wide ? 'true' : 'false' },
    h('span', { className: 'dsAuthUserBadgeAvatar', 'aria-hidden': 'true' }, h(UserIcon)),
    wide
      ? h('span', { className: 'dsAuthUserBadgeName', title: shown }, shown)
      : null,
    wide
      ? h('button', {
          className: 'dsAuthUserBadgeExit',
          type: 'button',
          title: tr('logout'),
          'aria-label': tr('logout'),
          onClick: () => { void exit() },
          disabled: busy,
        }, h(ExitIcon))
      : null,
  )
}

/**
 * 用户图标（16×16，currentColor + 2 线宽，颜色随主题）。
 */
function UserIcon() {
  return h('svg', {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    'data-icon': 'auth-gate-user',
    'aria-hidden': 'true',
  },
    h('circle', { cx: 8, cy: 5.25, r: 2.6, stroke: 'currentColor', strokeWidth: 2 }),
    h('path', {
      d: 'M2.6 13.5c.55-2.65 2.75-4.1 5.4-4.1s4.85 1.45 5.4 4.1',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
    }),
  )
}

/** 退出登录图标（门 + 向外箭头，currentColor + 2 线宽）。 */
function ExitIcon() {
  return h('svg', {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    'data-icon': 'auth-gate-exit',
    'aria-hidden': 'true',
  },
    h('path', {
      d: 'M6.75 2.5H4.5c-.83 0-1.5.67-1.5 1.5v8c0 .83.67 1.5 1.5 1.5h2.25',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
    }),
    h('path', {
      d: 'M10.25 5.25 13 8l-2.75 2.75M6.5 8h6.5',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  )
}

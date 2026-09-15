/**
 * 全屏登录 / 拦截页。
 *
 * **这一个组件同时服务两种闸门形态**（`overlay` 与 `root-shadow`）—— 差别只在
 * 注册到哪个槽位（见 lib/gate-mode.js）。所以这里不需要知道任何关于形态的事，
 * 样式上也不能依赖"父容器会给我多大地方"：`.dsAuthGate` 用 `position: fixed;
 * inset: 0` 自己铺满视口。
 *
 * 用 `createElement` 而不是 JSX：这个包零构建、零依赖，不引入编译器。
 */

import {
  createElement as h,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { AUTH_STATUS } from '../../lib/constants.js'
import { failureKey } from './locales.js'

/**
 * 闸门页组件。
 *
 * @param {object} props - 组合 props。
 * @param {object} props.gate - 闸门控制器（由注册处的 `inject` 注入）。
 * @param {(key: string) => string} [props.t] - locale 命名空间绑定的翻译函数。
 * @returns {object|null} React 节点；已授权时返回 null。
 */
export function AuthGateView(props) {
  const gate = props.gate
  const tr = typeof props.t === 'function' ? props.t : (key) => key

  const view = useSyncExternalStore(gate.subscribe, gate.getSnapshot, gate.getSnapshot)
  const status = view.snapshot.status

  const [serverAddress, setServerAddress] = useState(gate.getDefaultServerAddress())
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const rootRef = useRef(null)

  // 键盘旁路缓解：`overlay` 形态下 AppFrame 仍在后台挂载，它的全局快捷键与命令
  // 面板可能被键盘触达。在闸门页上把事件冒泡掐断，能挡住监听了冒泡阶段的那些。
  //
  // 这**不是**完整防护：如果某个监听器注册在 document 的捕获阶段，它比这里先跑，
  // 我们拦不住。真正兜底的是 Host 侧那两道闸门（llm/stream + tools.guard）——
  // 即使键盘被绕过，模型与工具仍然是拒的。这也是为什么形态选 overlay 是可接受的。
  useEffect(() => {
    const element = rootRef.current
    if (element === null) return undefined
    const swallow = (event) => event.stopPropagation()
    element.addEventListener('keydown', swallow)
    element.addEventListener('keyup', swallow)
    element.addEventListener('keypress', swallow)
    return () => {
      element.removeEventListener('keydown', swallow)
      element.removeEventListener('keyup', swallow)
      element.removeEventListener('keypress', swallow)
    }
  }, [])

  const submit = useCallback(async (event) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await gate.login({ serverAddress, username, password })
    } finally {
      setBusy(false)
      // 提交完立刻把密码从组件状态里抹掉：它只该活在这一次请求里。
      setPassword('')
    }
  }, [busy, gate, password, serverAddress, username])

  const recheck = useCallback(() => { void gate.recheck() }, [gate])

  if (status === AUTH_STATUS.AUTHENTICATED) return null

  const failure = view.failure
  const reason = view.snapshot.reason
  const canRetry = status === AUTH_STATUS.UNREACHABLE

  /** 表单上方的提示区：失败优先，其次是原因说明。 */
  let notice = null
  if (failure !== null) {
    notice = h('p', { className: 'dsAuthGateError', role: 'alert' }, tr(failureKey(failure)))
  } else if (canRetry) {
    notice = h('p', { className: 'dsAuthGateNotice' }, tr('unreachableHint'))
  } else if (reason === 'expired' || reason === 'rejected') {
    notice = h('p', { className: 'dsAuthGateNotice' }, tr('expiredHint'))
  } else if (reason === 'logout') {
    notice = h('p', { className: 'dsAuthGateNotice' }, tr('logoutHint'))
  }

  const heading = canRetry
    ? tr('unreachableTitle')
    : (reason === 'expired' || reason === 'rejected' ? tr('unauthenticatedTitle') : tr('title'))

  /** 校验中：不放表单，避免用户在结论出来前输入凭据。 */
  if (status === AUTH_STATUS.CHECKING && failure === null) {
    return h('div', { className: 'dsAuthGate', ref: rootRef, role: 'dialog', 'aria-modal': 'true' },
      h('div', { className: 'dsAuthGatePanel' },
        h('h1', { className: 'dsAuthGateTitle' }, heading),
        h('p', { className: 'dsAuthGateSubtitle' }, tr('checking')),
        h('span', { className: 'dsAuthGateSpinner', 'aria-hidden': 'true' }),
      ),
    )
  }

  return h('div', { className: 'dsAuthGate', ref: rootRef, role: 'dialog', 'aria-modal': 'true' },
    h('div', { className: 'dsAuthGatePanel' },
      h('h1', { className: 'dsAuthGateTitle' }, heading),
      h('p', { className: 'dsAuthGateSubtitle' }, tr('subtitle')),
      notice,
      h('form', { onSubmit: submit, noValidate: true },
        field(tr('fieldServer'), serverAddress, setServerAddress, 'url', busy, tr('placeholderServer'), 'url'),
        field(tr('fieldUsername'), username, setUsername, 'username', busy, undefined, 'username'),
        field(tr('fieldPassword'), password, setPassword, 'password', busy, undefined, 'current-password'),
        h('button', {
          className: 'dsAuthGateSubmit',
          type: 'submit',
          disabled: busy,
        }, busy ? tr('submitting') : tr('submit')),
      ),
      canRetry
        ? h('div', { className: 'dsAuthGateActions' },
            h('button', { className: 'dsAuthGateSecondary', type: 'button', onClick: recheck }, tr('retry')))
        : null,
      // 连不上服务器时，把"上次是谁、连的哪台"摆出来 —— 排查网络的人第一眼要的就是这两个。
      view.snapshot.serverAddress && view.snapshot.username
        ? h('p', { className: 'dsAuthGateMeta' },
            `${tr('signedInAs')}: ${view.snapshot.username} · ${view.snapshot.serverAddress}`)
        : null,
    ),
  )
}

/**
 * 渲染一个表单字段。
 *
 * @param {string} label - 已翻译的标签文案。
 * @param {string} value - 当前值。
 * @param {(next: string) => void} onChange - 变更回调。
 * @param {string} type - input 类型。
 * @param {boolean} disabled - 是否禁用。
 * @param {string} [placeholder] - 占位文案（仅服务器地址用）。
 * @param {string} [autoComplete] - autocomplete 提示。
 * @returns {object} React 节点。
 */
function field(label, value, onChange, type, disabled, placeholder, autoComplete) {
  return h('label', { className: 'dsAuthGateField' },
    h('span', { className: 'dsAuthGateLabel' }, label),
    h('input', {
      className: 'dsAuthGateInput',
      type,
      value,
      disabled,
      placeholder,
      autoComplete,
      spellCheck: false,
      autoCapitalize: 'off',
      onChange: (event) => onChange(event.target.value),
    }),
  )
}

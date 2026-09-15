/**
 * 闸门界面的样式。
 *
 * 两点刻意的选择：
 *
 * 1. **不猜客户端主题变量名**。样式自持（自带 CSS 变量 + `prefers-color-scheme`
 *    回退），所以无论是 web 组合还是桌面组合、无论主题插件怎么改，闸门页都不会
 *    变成白底白字。代价是它不会跟着产品主色走 —— 对一个登录页来说这个代价可以接受。
 * 2. **`position: fixed; inset: 0`**。这一个选择让 overlay 与 root-shadow 两种形态
 *    共用同一份样式：作为浮层时铺满视口，作为整页时同样铺满视口。
 *    `pointer-events` 显式打开，不依赖宿主的 overlay 容器是否给了穿透规则。
 */

const STYLE_ID = 'dsh-auth-gate-styles'

const CSS = `
.dsAuthGate {
  --dsag-bg: #ffffff;
  --dsag-fg: #16181d;
  --dsag-muted: #6b7280;
  --dsag-border: rgba(16, 20, 30, 0.12);
  --dsag-field: rgba(16, 20, 30, 0.04);
  --dsag-accent: #2f6bef;
  --dsag-accent-fg: #ffffff;
  --dsag-danger: #c0392b;
  --dsag-danger-bg: rgba(192, 57, 43, 0.08);

  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  pointer-events: auto;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--dsag-fg);
  background: color-mix(in srgb, var(--dsag-bg) 78%, transparent);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
}

@media (prefers-color-scheme: dark) {
  .dsAuthGate {
    --dsag-bg: #14161c;
    --dsag-fg: #f2f4f8;
    --dsag-muted: #9aa3b2;
    --dsag-border: rgba(255, 255, 255, 0.14);
    --dsag-field: rgba(255, 255, 255, 0.06);
    --dsag-accent: #4d84ff;
    --dsag-danger: #ff8a80;
    --dsag-danger-bg: rgba(255, 138, 128, 0.12);
  }
}

.dsAuthGatePanel {
  width: 100%;
  max-width: 420px;
  box-sizing: border-box;
  padding: 28px 28px 24px;
  border: 1px solid var(--dsag-border);
  border-radius: 16px;
  background: var(--dsag-bg);
  box-shadow: 0 24px 60px rgba(8, 12, 24, 0.22);
}

.dsAuthGateTitle {
  margin: 0 0 6px;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.dsAuthGateSubtitle {
  margin: 0 0 20px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--dsag-muted);
}

.dsAuthGateField {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}

.dsAuthGateLabel {
  font-size: 12px;
  font-weight: 500;
  color: var(--dsag-muted);
}

.dsAuthGateInput {
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--dsag-border);
  border-radius: 9px;
  background: var(--dsag-field);
  color: inherit;
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}

.dsAuthGateInput:focus {
  border-color: var(--dsag-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsag-accent) 22%, transparent);
}

.dsAuthGateInput:disabled { opacity: 0.6; }

.dsAuthGateSubmit {
  width: 100%;
  height: 40px;
  margin-top: 6px;
  border: none;
  border-radius: 9px;
  background: var(--dsag-accent);
  color: var(--dsag-accent-fg);
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: opacity 120ms ease;
}

.dsAuthGateSubmit:disabled { opacity: 0.6; cursor: default; }

.dsAuthGateError {
  margin: 0 0 14px;
  padding: 9px 12px;
  border-radius: 9px;
  border: 1px solid color-mix(in srgb, var(--dsag-danger) 35%, transparent);
  background: var(--dsag-danger-bg);
  color: var(--dsag-danger);
  font-size: 13px;
  line-height: 1.5;
}

.dsAuthGateNotice {
  margin: 0 0 14px;
  padding: 9px 12px;
  border-radius: 9px;
  border: 1px solid var(--dsag-border);
  background: var(--dsag-field);
  font-size: 13px;
  line-height: 1.5;
}

.dsAuthGateMeta {
  margin: 16px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--dsag-border);
  font-size: 12px;
  line-height: 1.7;
  color: var(--dsag-muted);
  word-break: break-all;
}

.dsAuthGateActions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.dsAuthGateSecondary {
  flex: 1;
  height: 36px;
  border: 1px solid var(--dsag-border);
  border-radius: 9px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
}

.dsAuthGateSpinner {
  display: block;
  width: 22px;
  height: 22px;
  margin: 18px auto 4px;
  border: 2px solid var(--dsag-border);
  border-top-color: var(--dsag-accent);
  border-radius: 50%;
  animation: dsAuthGateSpin 720ms linear infinite;
}

@keyframes dsAuthGateSpin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .dsAuthGateSpinner { animation-duration: 2s; }
}

/* ── 侧边栏用户栏（sidebar.footer.action）────────────────────────────────
 * 布局说明：让「插件市场 / 设置齿轮 / 用户栏」在脚部纵排堆叠所需的
 * 不做任何容器布局手术 —— 曾经的两个版本（全局属性选择器版、closest+inline
 * style 版）都与设置页/设置菜单异常相关，2026-09-15 第三次事故后全部移除。
 * 这里只有用户栏自身的样式，全部 .dsAuth 前缀，不可能越界。 */

/* 颜色策略：badge 自带一套文字/图标色（--dsaub-fg / --dsaub-muted），暗色走
 * prefers-color-scheme。曾尝试删掉 color 改为继承宿主，实测出现问题（2026-09-15
 * 用户反馈），已回退到自带调色板方案。自留 --dsaub-hover 为 hover 底色。 */
.dsAuthUserBadge {
  --dsaub-fg: #16181d;
  --dsaub-muted: #6b7280;
  --dsaub-hover: rgba(16, 20, 30, 0.06);

  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  min-height: 36px;
  padding: 7px 8px;
  border-radius: 8px;
  color: var(--dsaub-fg);
  font-size: 14px;
  line-height: 22px;
  font-family: inherit;
}

.dsAuthUserBadge:hover { background: var(--dsaub-hover); }

/* 展开态：宿主行内自然排列（不再用 order 参与容器布局手术） */
.dsAuthUserBadge[data-wide='true'] {
  margin: 2px 0;
}

/* 窄栏收起态：对齐市场入口的圆钮规格（36×36），纵列居成一列圆点 */
.dsAuthUserBadge[data-wide='false'] {
  width: 36px;
  height: 36px;
  min-height: 0;
  justify-content: center;
  padding: 0;
  border-radius: 50%;
  margin: 4px 0;
}

@media (prefers-color-scheme: dark) {
  .dsAuthUserBadge {
    --dsaub-fg: #f2f4f8;
    --dsaub-muted: #9aa3b2;
    --dsaub-hover: rgba(255, 255, 255, 0.08);
  }
}

/* 与官方行条目对齐：图标位 16×16（panelRow 的 glyph 规格），行高 36、
 * 左内边距 8、gap 8 —— 用户图标、名字与「插件市场」「设置」的图标同轴。
 * 图标走 currentColor，容器显式给 muted 色（继承宿主方案已回退）。 */
.dsAuthUserBadgeAvatar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--dsaub-muted);
}

.dsAuthUserBadgeName {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsAuthUserBadgeExit {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--dsaub-muted);
  padding: 0;
  border-radius: 6px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.dsAuthUserBadgeExit:hover:not(:disabled) {
  background: var(--dsaub-hover);
  color: var(--dsaub-fg);
}

.dsAuthUserBadgeExit:disabled { opacity: 0.5; cursor: default; }
`

/**
 * 注入样式（幂等）。
 *
 * @returns {() => void} 移除样式的清理函数；若样式已存在则返回空操作
 *          （说明另一个实例已经装了，不该由这个实例拆掉）。
 */
export function installGateStyles() {
  if (typeof document === 'undefined') return () => {}
  if (document.getElementById(STYLE_ID) !== null) return () => {}

  const element = document.createElement('style')
  element.id = STYLE_ID
  element.textContent = CSS
  document.head.appendChild(element)
  return () => element.remove()
}

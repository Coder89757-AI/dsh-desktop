/** Offline-plugins panel styles, installed once per client boot. */

const STYLE_ID = 'dshOfflinePluginsStyles'

const CSS_LINES: readonly string[] = [
  '.dshOfflineBody{display:flex;flex-direction:column;gap:10px;width:100%}',
  '.dshOfflineHeading{margin:6px 0 0;font-size:13px;font-weight:600;opacity:.9}',
  '.dshOfflineIntro{margin:0;font-size:12.5px;opacity:.75;line-height:1.5}',
  '.dshOfflineList{display:flex;flex-direction:column;gap:6px}',
  '.dshOfflineItem{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;',
  '  background:var(--dsh-hover,rgba(128,128,128,.1))}',
  '.dshOfflineItemMain{flex:1;min-width:0}',
  '.dshOfflineItemName{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshOfflineItemMeta{font-size:11.5px;opacity:.65}',
  '.dshOfflineBadge{font-size:10.5px;padding:1px 6px;border-radius:999px;border:1px solid currentColor;opacity:.75}',
  '.dshOfflineBtn{border:0;border-radius:8px;padding:7px 12px;cursor:pointer;font:inherit;font-size:12.5px;',
  '  background:var(--dsw-alias-button-primary-fill,#2563eb);color:var(--dsw-alias-label-primary-inverted,#fff);',
  '  transition:background var(--ds-transition-duration-fast,.15s) var(--ds-ease-in-out,ease)}',
  '.dshOfflineBtn:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#1d4ed8)}',
  '.dshOfflineBtn:disabled{opacity:.5;cursor:default}',
  '.dshOfflineBtn[data-variant="ghost"]{background:var(--dsw-alias-button-tool-bar-fill,rgba(128,128,128,.12));',
  '  color:var(--dsw-alias-label-primary,#111)}',
  '.dshOfflineBtn[data-variant="ghost"]:hover:not(:disabled){background:var(--dsw-alias-button-tool-bar-hover,rgba(128,128,128,.2))}',
  '.dshOfflineProgressBlock{display:flex;flex-direction:column;gap:4px}',
  '.dshOfflineProgress{height:6px;border-radius:999px;overflow:hidden;',
  '  background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.15))}',
  '.dshOfflineProgressFill{height:100%;border-radius:999px;',
  '  background:var(--dsw-alias-button-primary-fill,#2563eb);',
  '  transition:width var(--ds-transition-duration,.2s) var(--ds-ease-in-out,ease)}',
  '.dshOfflineProgressMeta{font-size:11.5px;color:var(--dsw-alias-label-secondary,#555)}',
  '.dshOfflineMsg{margin:0;font-size:12.5px;line-height:1.5}',
  '.dshOfflineMsg[data-kind="error"]{color:var(--dsw-static-red-500,#dc2626)}',
  '.dshOfflineMsg[data-kind="ok"]{color:var(--dsw-static-green-500,#16a34a)}',
  '.dshOfflineEmpty{margin:0;font-size:12.5px;opacity:.6}',
]

export function installOfflinePluginsStyles(): () => void {
  document.getElementById(STYLE_ID)?.remove()
  const element = document.createElement('style')
  element.id = STYLE_ID
  element.textContent = CSS_LINES.join('\n')
  document.head.append(element)
  return () => { element.remove() }
}

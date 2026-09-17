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
  '  background:var(--dsh-primary,#2563eb);color:#fff}',
  '.dshOfflineBtn:disabled{opacity:.5;cursor:default}',
  '.dshOfflineMsg{margin:0;font-size:12.5px;line-height:1.5}',
  '.dshOfflineMsg[data-kind="error"]{color:#dc2626}',
  '.dshOfflineMsg[data-kind="ok"]{color:#16a34a}',
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

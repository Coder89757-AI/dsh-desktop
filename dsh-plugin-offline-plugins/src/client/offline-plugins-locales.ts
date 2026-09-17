/** Offline-plugins client dictionaries (zh / en). */

export type OfflinePluginsLocaleKey =
  | 'title' | 'railTitle' | 'intro' | 'close'
  | 'installedHeading' | 'importHeading' | 'importAction' | 'importing'
  | 'exportAction' | 'exporting' | 'exportDone' | 'importDone'
  | 'needsRestart' | 'loadFailed' | 'pickFailed' | 'immutableBadge'
  | 'disabledBadge' | 'exportUnresolved' | 'noPlugins' | 'unknownError'
  | 'hostStale'

export const zh: Record<OfflinePluginsLocaleKey, string> = {
  title: '离线插件管理',
  railTitle: '离线插件管理',
  intro: '导出本机已安装的 Profile 插件（含完整依赖），或导入其他电脑导出的插件目录。导入后重启生效。',
  close: '关闭',
  installedHeading: '已安装插件',
  importHeading: '从导出目录导入',
  importAction: '选择导出目录并导入',
  importing: '导入中',
  exportAction: '导出',
  exporting: '导出中',
  exportDone: '导出完成',
  importDone: '导入完成',
  needsRestart: '重启 法海问津 后新插件生效。',
  loadFailed: '无法读取插件清单。',
  pickFailed: '无法打开系统目录选择器。',
  immutableBadge: '内置',
  disabledBadge: '已禁用',
  exportUnresolved: '（部分依赖未随包导出，目标机器需已具备）',
  noPlugins: '当前 Profile 没有可管理的 Profile 级插件。',
  unknownError: '操作失败。',
  hostStale: 'Host 未加载新版离线插件接口（客户端已热更新）。请重启 法海问津 后重试。',
}

export const en: Record<OfflinePluginsLocaleKey, string> = {
  title: 'Offline Plugins',
  railTitle: 'Offline plugin manager',
  intro: 'Export installed Profile plugins (with their full dependency closure) or import an export directory from another machine. Imported plugins load after a restart.',
  close: 'Close',
  installedHeading: 'Installed plugins',
  importHeading: 'Import from an export directory',
  importAction: 'Choose export directory and import',
  importing: 'Importing…',
  exportAction: 'Export',
  exporting: 'Exporting…',
  exportDone: 'Export complete',
  importDone: 'Import complete',
  needsRestart: 'Restart 法海问津 to load newly imported plugins.',
  loadFailed: 'The plugin inventory could not be read.',
  pickFailed: 'The system folder picker could not be opened.',
  immutableBadge: 'Built-in',
  disabledBadge: 'Disabled',
  exportUnresolved: ' (some dependencies were not included; the target machine must already provide them)',
  noPlugins: 'The active Profile has no manageable Profile-level plugins.',
  unknownError: 'The operation failed.',
  hostStale: 'The Host is not running the new offline-plugins API (the client hot-reloaded). Restart 法海问津 and try again.',
}

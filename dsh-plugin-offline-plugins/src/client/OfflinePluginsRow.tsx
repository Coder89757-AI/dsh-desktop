/** One installed plugin row with its export action. */

import type { OfflinePluginEntry } from '../offline/contract.ts'
import type { OfflinePluginsLocaleKey } from './offline-plugins-locales.ts'

interface OfflinePluginsRowProps {
  readonly entry: OfflinePluginEntry
  readonly t: (key: OfflinePluginsLocaleKey) => string
  readonly busy: boolean
  readonly onExport: (name: string) => void
}

export function OfflinePluginsRow(props: OfflinePluginsRowProps) {
  const { entry, t, busy, onExport } = props
  return (
    <div className="dshOfflineItem">
      <div className="dshOfflineItemMain">
        <div className="dshOfflineItemName">{entry.name}</div>
        <div className="dshOfflineItemMeta">v{entry.version}</div>
      </div>
      {entry.immutable && <span className="dshOfflineBadge">{t('immutableBadge')}</span>}
      {entry.disabled && <span className="dshOfflineBadge">{t('disabledBadge')}</span>}
      {!entry.immutable && (
        <button
          type="button"
          className="dshOfflineBtn"
          disabled={busy}
          onClick={() => { onExport(entry.name) }}
        >
          {t('exportAction')}
        </button>
      )}
    </div>
  )
}
